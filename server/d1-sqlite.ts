/**
 * D1 → 本地 SQLite 适配层
 *
 * 让 src/ 下那套按 Cloudflare D1 写的数据访问代码（DatabaseManager）在 Node 里原样跑起来：
 * 这里实现 D1Database / D1PreparedStatement 的对外行为，底层换成同步的 SQLite 驱动。
 * 业务代码（src/db.ts 等）一行都不用改。
 *
 * NOTE: 刻意不 import 具体驱动的类型，只用下面的最小接口做鸭子类型约束。
 * node:sqlite 的 DatabaseSync（默认选择，Node 内置、无原生依赖）与 better-sqlite3
 * 都满足这个接口，将来换驱动不必动本文件。
 */

/** 写操作的返回信息 —— node:sqlite 与 better-sqlite3 的字段名一致 */
export interface SqliteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/** 预编译语句 */
export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

/** 数据库连接 */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
}

/**
 * 预编译语句缓存上限
 *
 * NOTE: 域名 UPSERT 这类语句在一次同步里会跑上百次，缓存能省掉同样次数的编译；
 * 但 getWhoisPool() 会把几百个域名内联进 SQL 文本，每批都是一条全新的 SQL，
 * 不设上限缓存就会无限膨胀。超限后按插入顺序淘汰最旧的一条。
 */
const STATEMENT_CACHE_LIMIT = 128;

/**
 * 判断一条 SQL 是否为「返回结果集」的读语句
 *
 * NOTE: 驱动之间对「在写语句上调 all()」的处理不一致（node:sqlite 返回空数组，
 * better-sqlite3 直接抛错），统一按语句类型分流到 all() / run()，两种驱动行为一致。
 */
function isReaderSql(sql: string): boolean {
  return /^\s*(?:select|pragma|with|explain)\b/i.test(sql);
}

/**
 * 绑定参数归一化
 *
 * SQLite 驱动只接受 null / 数字 / 字符串 / bigint / 二进制，而调用方偶尔会传进
 * undefined 或布尔值（D1 会自行转换）。这里补齐同样的宽容度，避免出现
 * 「D1 上正常、Docker 上报 Invalid value」这种只在自建版复现的差异。
 */
function normalizeParam(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`SQLite 不支持的绑定参数类型: ${Object.prototype.toString.call(value)}`);
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * 构造 D1Meta
 *
 * NOTE: rows_read / size_after 是 D1 的计费与观测字段，本地 SQLite 无对应概念，
 * 填 0 占位。业务代码只读 meta.changes（见 db.ts 的 purgeExpiredCache 等）。
 */
function buildMeta(changes: number, lastRowId: number, durationMs: number): D1Meta & Record<string, unknown> {
  return {
    duration: durationMs,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

/** 一条语句同步执行后的原始结果，供 batch() 在事务内收集 */
interface RawExecResult {
  rows: unknown[];
  changes: number;
  lastRowId: number;
}

/**
 * D1PreparedStatement 的 SQLite 实现
 *
 * NOTE: 必须保持 D1 的不可变语义 —— bind() 返回一条新语句而不是原地改写自己。
 * db.ts 的 buildDomainUpsert() 会把 bind() 的结果同时交给 .run() 和 batch()，
 * 如果 bind() 改的是同一个对象，两条路径会互相踩参数。
 */
class SqliteD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly owner: SqliteD1Database,
    private readonly sql: string,
    private readonly params: readonly unknown[] = []
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1PreparedStatement(this.owner, this.sql, values.map(normalizeParam));
  }

  /** 同步执行本语句（batch() 需要在一个事务里连续跑多条，不能是异步的） */
  execSync(): RawExecResult {
    const stmt = this.owner.getStatement(this.sql);
    const args = this.params as unknown[];
    if (isReaderSql(this.sql)) {
      return { rows: stmt.all(...args), changes: 0, lastRowId: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], changes: toNumber(info.changes), lastRowId: toNumber(info.lastInsertRowid) };
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    const stmt = this.owner.getStatement(this.sql);
    const row = stmt.get(...(this.params as unknown[]));
    // 无匹配行时驱动返回 undefined，D1 返回 null —— 统一成 null
    if (row === undefined || row === null) return null;
    if (colName !== undefined) {
      const value = (row as Record<string, unknown>)[colName];
      return (value === undefined ? null : value) as T;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = Date.now();
    const res = this.execSync();
    return {
      results: res.rows as T[],
      success: true,
      meta: buildMeta(res.changes, res.lastRowId, Date.now() - started),
    };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = Date.now();
    const res = this.execSync();
    return {
      results: res.rows as T[],
      success: true,
      meta: buildMeta(res.changes, res.lastRowId, Date.now() - started),
    };
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const rows = this.execSync().rows as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const values = rows.map((row) => columns.map((col) => row[col]) as unknown as T);
    // NOTE: 结果集为空时拿不到列名（驱动接口里没有 columns()），只能返回空列名数组。
    // 当前业务代码不用 raw()，此实现仅为补全 D1 接口。
    return options?.columnNames ? [columns, ...values] : values;
  }
}

/**
 * D1Database 的 SQLite 实现
 */
export class SqliteD1Database implements D1Database {
  private readonly cache = new Map<string, SqliteStatement>();

  constructor(private readonly sqlite: SqliteDatabase) {}

  /** 取预编译语句（带上限缓存）—— 同步驱动下 run/all/get 不会交错，复用是安全的 */
  getStatement(sql: string): SqliteStatement {
    const cached = this.cache.get(sql);
    if (cached) return cached;
    const stmt = this.sqlite.prepare(sql);
    if (this.cache.size >= STATEMENT_CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(sql, stmt);
    return stmt;
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1PreparedStatement(this, query);
  }

  /**
   * 批量执行
   *
   * NOTE: D1 的 batch() 是一个隐式事务（全部成功或全部回滚），这里用显式
   * BEGIN/COMMIT 复现。db.ts 的 syncAccountDomains() 依赖这个原子性：
   * UPSERT 与 DELETE 混在一批里，中途失败必须整批回退，不能留下半同步状态。
   */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const started = Date.now();
    this.sqlite.exec("BEGIN");
    try {
      const raw = statements.map((stmt) => (stmt as SqliteD1PreparedStatement).execSync());
      this.sqlite.exec("COMMIT");
      const duration = Date.now() - started;
      return raw.map((res) => ({
        results: res.rows as T[],
        success: true as const,
        meta: buildMeta(res.changes, res.lastRowId, duration),
      }));
    } catch (e) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // 事务已因错误自动回滚时 ROLLBACK 会再报一次错，忽略，保留原始异常
      }
      throw e;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    const started = Date.now();
    this.sqlite.exec(query);
    const count = query
      .split(";")
      .filter((part) => part.trim().length > 0).length;
    return { count, duration: Date.now() - started };
  }

  /**
   * D1 的读副本会话
   *
   * NOTE: 本地只有一个 SQLite 文件，顺序一致性天然成立，因此「会话」就是数据库本身。
   * bookmark 无意义，返回 null。
   */
  withSession(): D1DatabaseSession {
    const self = this;
    return {
      prepare: (query: string) => self.prepare(query),
      batch: <T = unknown>(statements: D1PreparedStatement[]) => self.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    // D1 alpha 时代的接口，早已废弃；自建版直接备份 .db 文件即可
    return Promise.reject(new Error("本地 SQLite 适配层不支持 dump()，请直接备份数据库文件"));
  }
}

/**
 * 用一个同步 SQLite 连接构造 D1Database
 */
export function createD1FromSqlite(sqlite: SqliteDatabase): D1Database {
  return new SqliteD1Database(sqlite);
}
