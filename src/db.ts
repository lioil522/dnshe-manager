import { DNSHEClient } from "./dnshe";

/**
 * 导入 Crypto 工具以处理 AES 加密
 * 
 * NOTE: 使用 SHA-256 将任意长度的密钥材料派生为 256 位 AES-GCM 密钥
 */
async function getCryptoKey(aesKeyStr: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(aesKeyStr);
  const hash = await crypto.subtle.digest("SHA-256", keyData);
  return await crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * AES-GCM 加密文本
 * 
 * NOTE: 当 aesKeyStr 存在但加密失败时，抛出异常而非静默降级为 Base64。
 * 仅在 aesKeyStr 本身为空时允许使用 Base64 弱编码作为降级方案。
 */
export async function encryptText(text: string, aesKeyStr?: string): Promise<string> {
  if (!aesKeyStr) {
    return "plain:" + btoa(text);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await getCryptoKey(aesKeyStr);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );
  
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  const encryptedHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${ivHex}:${encryptedHex}`;
}

/**
 * AES-GCM 解密文本
 */
export async function decryptText(encryptedText: string, aesKeyStr?: string): Promise<string> {
  if (encryptedText.startsWith("plain:")) {
    return atob(encryptedText.substring(6));
  }
  if (!aesKeyStr) {
    throw new Error("Encrypted secret requires AES_KEY to decrypt");
  }

  const parts = encryptedText.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid cipher format");
  }
  const ivHex = parts[0];
  const encryptedHex = parts[1];
  
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const cryptoKey = await getCryptoKey(aesKeyStr);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encrypted
  );
  
  return new TextDecoder().decode(decrypted);
}

/**
 * 使用 PBKDF2-HMAC-SHA256 派生密码哈希（10 万轮）
 *
 * NOTE: 返回十六进制的 32 字节派生密钥。盐值由调用方生成并单独存储，
 * 校验时使用相同盐值重新派生并做恒定时间比较，避免时序侧信道。
 */
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 生成 16 字节随机盐值的十六进制字符串
 */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 恒定时间字符串比较，防止基于响应耗时的时序攻击
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** 鉴权配置（读取后的解密/明文形态） */
export interface AuthConfig {
  username: string;
  passHash: string;
  passSalt: string;
  twoFaEnabled: boolean;
  twoFaSecret: string; // 已解密的 TOTP 密钥（Base32），未开启则为空
  initialized: boolean; // 是否已完成首次密码设置
}

export interface DBAccount {
  id: number;
  alias: string;
  api_key: string;
  created_at: string;
}

export interface DBDomain {
  id: number;
  account_id: number;
  account_alias?: string;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at?: string;
  expires_at: string;
  last_renewed_at: string | null;
  has_dns?: number;
  dns_provider?: string | null;
  /** 解析服务商账号 ID，用于判断该域名是否支持按线路解析（见 dnshe.ts 的字段注释） */
  provider_account_id?: string | null;
  updated_at: string;
}

export interface DBLog {
  id: number;
  type: string;
  category: string;
  message: string;
  details: string | null;
  created_at: string;
}

/**
 * 写入 domains_cache 的上游域名数据
 *
 * NOTE: dns_state_known 表示本次调用已经拉取过该域名的真实解析记录，
 * 因此 status / has_dns / dns_provider 可信、允许覆盖数据库中的旧值。
 * 由 dns-provider.ts 的 computeDnsState() 统一产出，不要手工拼装。
 */
export interface UpstreamSubdomain {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at?: string;
  expires_at?: string;
  disable_ns_management?: boolean | number;
  has_dns?: boolean | number;
  ns1?: string;
  ns2?: string;
  dns_provider?: string;
  provider_account_id?: number | string | null;
  dns_state_known?: boolean;
}

/** domains_cache.status 允许的三态取值（由 computeDnsState 产出） */
const THREE_STATE_STATUSES = new Set(["已委派", "已解析", "未解析"]);

/** 全部账号配额的缓存键（内容为按 account_id 升序排列的数组） */
export const QUOTA_CACHE_KEY = "api_cache:quota";

/** 配额缓存中的单个账号条目：成功时展开 quota 字段，失败时带 error */
export type QuotaEntry = { account_id: number; alias: string; [key: string]: unknown };

/**
 * 数据库封装操作
 *
 * NOTE: 使用 D1Database 类型替代 any，获得完整的编译期类型检查
 */
export class DatabaseManager {
  private db: D1Database;
  private aesKey?: string;

  constructor(d1Database: D1Database, aesKey?: string) {
    this.db = d1Database;
    this.aesKey = aesKey;
  }

  /**
   * 自动确保所需的 D1 数据库表结构存在
   *
   * 返回是否自举成功。调用方（index.ts 的 ensureSchemaOnce）据此决定
   * 是否缓存结果——失败就不缓存，留给下一次请求重试。
   */
  async ensureTables(): Promise<boolean> {
    try {
      await this.db.batch([
        this.db.prepare(`
          CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alias TEXT NOT NULL,
            api_key TEXT NOT NULL UNIQUE,
            api_secret TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `),
        this.db.prepare(`
          CREATE TABLE IF NOT EXISTS domains_cache (
            id INTEGER PRIMARY KEY,
            account_id INTEGER NOT NULL,
            subdomain TEXT NOT NULL,
            rootdomain TEXT NOT NULL,
            full_domain TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT,
            expires_at TEXT NOT NULL,
            last_renewed_at TEXT,
            has_dns INTEGER DEFAULT 1,
            dns_provider TEXT,
            provider_account_id TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
          );
        `),
        this.db.prepare(`
          CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `),
        this.db.prepare(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `),
        this.db.prepare(`
          CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at INTEGER NOT NULL
          );
        `)
      ]);

      // 兼容已部署的旧数据库：仅在缺少字段时执行一次轻量迁移。
      //
      // NOTE: 一次 PRAGMA 取回全部列名后统一补齐，缺几个字段都只多一次批量写，
      // 保持「自举 = 2 次串行往返」这个开销不变（见 README 的性能小节）。
      const domainColumns = await this.db.prepare("PRAGMA table_info(domains_cache)").all<{ name: string }>();
      const existingColumns = new Set((domainColumns.results || []).map((column) => column.name));
      const migrations: string[] = [];
      if (!existingColumns.has("dns_provider")) {
        migrations.push("ALTER TABLE domains_cache ADD COLUMN dns_provider TEXT");
      }
      if (!existingColumns.has("provider_account_id")) {
        migrations.push("ALTER TABLE domains_cache ADD COLUMN provider_account_id TEXT");
      }
      if (migrations.length > 0) {
        await this.db.batch(migrations.map((sql) => this.db.prepare(sql)));
      }
      return true;
    } catch (e) {
      console.error("Auto ensureTables error:", e);
      return false;
    }
  }

  /**
   * 获取系统设置/会话配置
   */
  async getSetting(key: string): Promise<string | null> {
    try {
      const res = await this.db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
      return res ? String((res as any).value) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 更新或保存系统设置/会话配置
   */
  async setSetting(key: string, value: string): Promise<void> {
    try {
      const now = this.getBeijingNow();
      await this.db.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(key, value, now).run();
    } catch (e) {
      console.error("setSetting error:", e);
    }
  }

  /**
   * 批量读取所有以 cfg_ 为前缀的应用配置项，返回去前缀后的键值对象
   *
   * NOTE: 敏感字段（如 Telegram Token）以 AES 加密形式存储，此处返回解密后的原文，
   * 由上层接口决定是否打码后再下发前端。
   */
  async getAllAppSettings(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const { results } = await this.db.prepare(
        "SELECT key, value FROM settings WHERE key LIKE 'cfg_%'"
      ).all<{ key: string; value: string }>();
      for (const row of results || []) {
        const shortKey = row.key.replace(/^cfg_/, "");
        let val = row.value;
        // 敏感字段解密
        if ((shortKey === "tg_token" || shortKey === "webhook_url") && val) {
          try {
            val = await decryptText(val, this.aesKey);
          } catch (e) {
            // 解密失败保持原值（可能是历史明文）
          }
        }
        out[shortKey] = val;
      }
    } catch (e) {
      console.error("getAllAppSettings error:", e);
    }
    return out;
  }

  /**
   * 保存单个应用配置项（自动加 cfg_ 前缀，敏感字段自动 AES 加密）
   */
  async setAppSetting(shortKey: string, value: string): Promise<void> {
    let stored = value;
    if ((shortKey === "tg_token" || shortKey === "webhook_url") && value) {
      try {
        stored = await encryptText(value, this.aesKey);
      } catch (e) {
        console.error("setAppSetting encrypt error:", e);
      }
    }
    await this.setSetting(`cfg_${shortKey}`, stored);
  }

  /**
   * 读取缓存值（仅在面板内写操作后失效，长期有效）
   *
   * NOTE: 此缓存模型为"写操作回源回填，读操作仅命中缓存"：
   * 只有面板内的增删改会删除/重填缓存，缓存本身不过期。
   * 为避免历史/意外长期占用，仍写入一个较远的绝对过期时间作为兜底。
   */
  async getCache(key: string): Promise<string | null> {
    try {
      const row = await this.db.prepare(
        "SELECT value FROM cache WHERE key = ? AND expires_at > ?"
      ).bind(key, Math.floor(Date.now() / 1000)).first<{ value: string }>();
      return row ? row.value : null;
    } catch (e) {
      console.error("getCache error:", e);
      return null;
    }
  }

  /**
   * 写入缓存（默认 1 年后过期，作为极端兜底；正常由写操作主动失效/重填）
   *
   * @param ttlSeconds 可选的自定义存活秒数。查重池等需要主动过期的场景传入较短 TTL
   *                   （如 7 天），以便结论到期后自动重新验证。
   */
  async setCache(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      // 默认 366 天的绝对过期时间，保证"不过期"语义的同时不会永久占用 D1 存储
      const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : 366 * 24 * 3600;
      const expiresAt = Math.floor(Date.now() / 1000) + ttl;
      await this.db.prepare(
        "INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
      ).bind(key, value, expiresAt).run();
    } catch (e) {
      console.error("setCache error:", e);
    }
  }

  /**
   * 批量查询查重池：返回其中「已确认已注册且尚未过期」的域名集合。
   *
   * 池子只缓存"已注册"这一相对稳定的结论（未注册域名随时可能被抢注，缓存无意义），
   * 并带 7 天 TTL，以覆盖"他人续费释放 / 用户主动删除后重新可注册"的场景。
   */
  async getWhoisPool(domains: string[]): Promise<string[]> {
    if (domains.length === 0) return [];

    // ⚠️ D1 硬上限：每条查询最多 100 个绑定参数（不是 SQLite 默认的 999）。
    // 早期实现用 IN (?,?,...) 逐个绑定域名，批量规模下必然超限并抛
    // "too many SQL variables"，异常又被吞掉 => 池子长期静默失效、白跑往返。
    //
    // 域名在入口处已统一经 toASCII() 归一化（必为小写纯 ASCII），
    // 这里再做一次严格白名单校验后内联为字面量，绑定参数恒定为 1 个。
    // 字符集限定 [a-z0-9.-] 不含引号/反斜杠，不存在注入面。
    const safe = domains.filter(d => /^[a-z0-9][a-z0-9.-]{0,252}$/.test(d));
    if (safe.length === 0) return [];

    const now = Math.floor(Date.now() / 1000);
    const hits: string[] = [];
    // D1 单条 SQL 语句上限 100KB；400 个域名内联后约 14KB，留足余量
    const STMT_CHUNK = 400;

    for (let i = 0; i < safe.length; i += STMT_CHUNK) {
      const list = safe
        .slice(i, i + STMT_CHUNK)
        .map(d => `'whois_pool:${d}'`)
        .join(",");
      const rows = await this.db.prepare(
        `SELECT key FROM cache WHERE key IN (${list}) AND expires_at > ?`
      ).bind(now).all<{ key: string }>();
      for (const r of rows.results || []) {
        hits.push(r.key.replace(/^whois_pool:/, ""));
      }
    }

    return hits;
  }

  /**
   * 清理已过期的缓存行（含查重池），避免 cache 表只进不出无限膨胀
   *
   * @returns 被删除的行数
   */
  async purgeExpiredCache(): Promise<number> {
    try {
      const res = await this.db.prepare(
        "DELETE FROM cache WHERE expires_at <= ?"
      ).bind(Math.floor(Date.now() / 1000)).run();
      return res.meta?.changes ?? 0;
    } catch (e) {
      console.error("purgeExpiredCache error:", e);
      return 0;
    }
  }

  /**
   * 将一个已确认「已注册」的域名写入查重池（默认 7 天后自动失效需重新验证）
   */
  async addToWhoisPool(domain: string, ttlSeconds = 7 * 24 * 3600): Promise<void> {
    await this.setCache(
      `whois_pool:${domain}`,
      JSON.stringify({ registered: true, ts: Math.floor(Date.now() / 1000) }),
      ttlSeconds
    );
  }

  /**
   * 删除指定缓存（写操作后调用，强制下一次读取回源刷新）
   */
  async deleteCache(key: string): Promise<void> {
    try {
      await this.db.prepare("DELETE FROM cache WHERE key = ?").bind(key).run();
    } catch (e) {
      console.error("deleteCache error:", e);
    }
  }

  // ===== 配额缓存的按账号维护 =====
  //
  // NOTE: 配额缓存走的是「写操作回源回填、读操作只命中缓存」模型，TTL 长达 366 天。
  // 但账号的增删改会改变账号集合，这份缓存却一直没跟着变，于是「账户配额」页
  // 依然列着已解绑的账号、也看不到新绑定的账号，只能点「刷新」强制回源才对得上。
  // 下面三个方法按账号粒度打补丁：解绑与改名零上游调用，只有新绑定/换 Key 才拉一次配额。
  // 缓存本就不存在时一律直接跳过 —— 下一次读取会整体回源重建。

  /** 读取配额缓存数组；缓存不存在或内容损坏时返回 null */
  private async readQuotaCache(): Promise<QuotaEntry[] | null> {
    const cached = await this.getCache(QUOTA_CACHE_KEY);
    if (!cached) return null;
    try {
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? (parsed as QuotaEntry[]) : null;
    } catch (e) {
      return null;
    }
  }

  /** 写回配额缓存，并保持与 getAccounts() 相同的 id ASC 顺序（配额页按数组顺序渲染） */
  private async writeQuotaCache(entries: QuotaEntry[]): Promise<void> {
    const sorted = [...entries].sort((a, b) => Number(a.account_id) - Number(b.account_id));
    await this.setCache(QUOTA_CACHE_KEY, JSON.stringify(sorted));
  }

  /** 解绑账号：摘掉对应条目 */
  async removeAccountFromQuotaCache(accountId: number): Promise<void> {
    const cached = await this.readQuotaCache();
    if (cached === null) return;
    await this.writeQuotaCache(cached.filter((q) => Number(q.account_id) !== accountId));
  }

  /** 仅改别名：就地改写缓存里的别名 */
  async renameAccountInQuotaCache(accountId: number, alias: string): Promise<void> {
    const cached = await this.readQuotaCache();
    if (cached === null) return;
    if (!cached.some((q) => Number(q.account_id) === accountId)) return;
    await this.writeQuotaCache(
      cached.map((q) => (Number(q.account_id) === accountId ? { ...q, alias } : q))
    );
  }

  /** 新绑定 / 换 Key：拉一次该账号的配额写回缓存，只影响这一个账号 */
  async refreshAccountQuotaCache(accountId: number, alias: string): Promise<void> {
    const cached = await this.readQuotaCache();
    if (cached === null) return;

    let entry: QuotaEntry;
    try {
      const { client } = await this.getClientForAccount(accountId);
      const qRes = await client.getQuota();
      entry = qRes && qRes.success
        ? { account_id: accountId, alias, ...qRes.quota }
        : { account_id: accountId, alias, error: qRes?.message || "获取额度失败" };
    } catch (e: unknown) {
      entry = { account_id: accountId, alias, error: e instanceof Error ? e.message : "获取额度失败" };
    }

    await this.writeQuotaCache([...cached.filter((q) => Number(q.account_id) !== accountId), entry]);
  }

  // ===== 会话 (Session) 管理 =====
  //
  // 会话以 settings 表中 key = `sess_<token>` 的行表示，value 存放到期时间的
  // Unix 秒级时间戳（字符串形式）。
  //
  // NOTE: 历史版本把 value 固定写成 "valid" 且从不删除，于是这张表随每次登录只进不出，
  //       而鉴权中间件每个请求都要查它。现在会话带过期时间，并由 purgeExpiredSessions()
  //       在每日 cron 中回收。为了不让这次升级把所有在线会话立刻踢下线，
  //       validateSession() 仍然接受历史遗留的 "valid" 值；这些旧行会在
  //       purgeExpiredSessions() 里按 updated_at 超过 TTL 后一并清掉，自然排空。

  /** 会话有效期：7 天 */
  static readonly SESSION_TTL_SECONDS = 7 * 24 * 3600;

  /**
   * 签发一个新会话，返回 Session Token
   */
  async createSession(ttlSeconds = DatabaseManager.SESSION_TTL_SECONDS): Promise<string> {
    const token = `dnshe_sess_${crypto.randomUUID()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    await this.setSetting(`sess_${token}`, String(expiresAt));
    return token;
  }

  /**
   * 校验会话是否有效（存在且未过期）
   */
  async validateSession(token: string): Promise<boolean> {
    const stored = await this.getSetting(`sess_${token}`);
    if (!stored) return false;
    // 历史遗留格式：升级前签发的会话没有到期时间，先放行，交给 cron 按 updated_at 回收
    if (stored === "valid") return true;
    const expiresAt = Number(stored);
    return Number.isFinite(expiresAt) && expiresAt > Math.floor(Date.now() / 1000);
  }

  /**
   * 清理已过期会话 — 供每日 cron 调用，返回清理条数
   */
  async purgeExpiredSessions(ttlSeconds = DatabaseManager.SESSION_TTL_SECONDS): Promise<number> {
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      // 1) 新格式：value 是到期时间戳，直接按数值比较
      const expired = await this.db.prepare(
        "DELETE FROM settings WHERE key LIKE 'sess_%' AND value != 'valid' AND CAST(value AS INTEGER) <= ?"
      ).bind(nowSec).run();

      // 2) 历史遗留格式：value = 'valid' 没有到期时间，退化为按 updated_at 超过 TTL 判定。
      //    updated_at 由 setSetting 以北京时间写入，所以这里也要用同一套格式生成截止值，
      //    否则会差 8 小时。格式定宽，字符串比较等价于时间比较。
      const legacyCutoff = this.toBeijingString(new Date((nowSec - ttlSeconds) * 1000));
      const legacy = await this.db.prepare(
        "DELETE FROM settings WHERE key LIKE 'sess_%' AND value = 'valid' AND updated_at <= ?"
      ).bind(legacyCutoff).run();

      return (expired.meta?.changes || 0) + (legacy.meta?.changes || 0);
    } catch (e) {
      console.error("purgeExpiredSessions error:", e);
      return 0;
    }
  }

  /**
   * 读取管理员鉴权配置
   *
   * NOTE: 鉴权相关配置以 auth_ 前缀独立存储于 settings 表。
   * TOTP 密钥使用 AES-GCM 加密，读取时自动解密为原文。
   */
  async getAuthConfig(): Promise<AuthConfig> {
    // NOTE: 这里原先是 5 次串行 await getSetting()，也就是 5 条独立 SELECT、5 次 D1 往返。
    //       D1 主库与执行 Worker 的边缘节点常常不在同一区域，单次往返实测 300-450ms，
    //       仅这一个函数就能给 /api/auth/status 这类"只读几行配置"的接口压上约 2 秒。
    //       改为一条 IN 查询后 5 次往返收敛成 1 次。
    const AUTH_KEYS = [
      "auth_username",
      "auth_pass_hash",
      "auth_pass_salt",
      "auth_2fa_enabled",
      "auth_2fa_secret",
    ];

    const values = new Map<string, string>();
    try {
      const { results } = await this.db
        .prepare(
          `SELECT key, value FROM settings WHERE key IN (${AUTH_KEYS.map(() => "?").join(", ")})`
        )
        .bind(...AUTH_KEYS)
        .all<{ key: string; value: string }>();
      for (const row of results || []) {
        values.set(row.key, String(row.value));
      }
    } catch (e) {
      // 与原 getSetting 的容错行为保持一致：读失败按「尚未配置」处理，
      // 调用方会落到未初始化分支，而不是抛错把登录页打死。
      console.error("getAuthConfig read error:", e);
    }

    const passHash = values.get("auth_pass_hash") || "";
    const encryptedSecret = values.get("auth_2fa_secret") || "";

    let twoFaSecret = "";
    if (encryptedSecret) {
      try {
        twoFaSecret = await decryptText(encryptedSecret, this.aesKey);
      } catch (e) {
        console.error("Failed to decrypt 2FA secret:", e);
      }
    }

    return {
      username: values.get("auth_username") || "admin",
      passHash,
      passSalt: values.get("auth_pass_salt") || "",
      twoFaEnabled: values.get("auth_2fa_enabled") === "1",
      twoFaSecret,
      initialized: !!passHash,
    };
  }

  /**
   * 设置/修改管理员密码（自动生成新盐值并哈希存储）
   */
  async setPassword(username: string, password: string): Promise<void> {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    await this.setSetting("auth_username", username);
    await this.setSetting("auth_pass_hash", hash);
    await this.setSetting("auth_pass_salt", salt);
  }

  /**
   * 校验管理员密码
   */
  async verifyPassword(password: string): Promise<boolean> {
    const cfg = await this.getAuthConfig();
    if (!cfg.passHash || !cfg.passSalt) return false;
    const hash = await hashPassword(password, cfg.passSalt);
    return timingSafeEqual(hash, cfg.passHash);
  }

  /**
   * 保存（加密）待启用的 2FA TOTP 密钥
   */
  async setTwoFaSecret(secretBase32: string): Promise<void> {
    const encrypted = await encryptText(secretBase32, this.aesKey);
    await this.setSetting("auth_2fa_secret", encrypted);
  }

  /**
   * 开启/关闭 2FA
   */
  async setTwoFaEnabled(enabled: boolean): Promise<void> {
    await this.setSetting("auth_2fa_enabled", enabled ? "1" : "0");
    if (!enabled) {
      // 关闭时清除密钥，避免残留
      await this.setSetting("auth_2fa_secret", "");
    }
  }

  /**
   * 获取当前北京时间 (UTC+8) 的 ISO 格式字符串
   *
   * NOTE: Cloudflare Workers / D1 的 CURRENT_TIMESTAMP 默认为 UTC，
   * 为了让日志时间与用户所在时区一致，手动构造北京时间。
   */
  private getBeijingNow(): string {
    return this.toBeijingString(new Date());
  }

  /**
   * 把任意时刻格式化成与 getBeijingNow() 完全一致的北京时间字符串
   *
   * NOTE: 供 purgeExpiredSessions() 生成与 updated_at 同格式的比较基准用。
   * 格式定宽（YYYY-MM-DD HH:mm:ss.sss），因此字符串比较等价于时间先后比较。
   */
  private toBeijingString(date: Date): string {
    const beijingOffset = 8 * 60 * 60 * 1000;
    const beijingTime = new Date(date.getTime() + beijingOffset);
    return beijingTime.toISOString().replace("T", " ").replace("Z", "");
  }

  /**
   * 写入日志
   */
  async writeLog(type: "info" | "success" | "warning" | "error", category: "sync" | "renew" | "system" | "auth" | "api" | "operation", message: string, details?: unknown) {
    try {
      const detailsStr = details ? (typeof details === "string" ? details : JSON.stringify(details)) : null;
      const beijingNow = this.getBeijingNow();
      await this.db.prepare(
        "INSERT INTO logs (type, category, message, details, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(type, category, message, detailsStr, beijingNow).run();
    } catch (e) {
      console.error("Failed to write database log:", e);
    }
  }

  /**
   * 获取日志列表 (按时间倒序，限制100条)
   *
   * NOTE: 可选按 categories 过滤（传入分类数组，如 ["api","sync","renew"]）。
   */
  async getLogs(limit = 100, categories?: string[]): Promise<DBLog[]> {
    if (categories && categories.length > 0) {
      const placeholders = categories.map(() => "?").join(",");
      const { results } = await this.db.prepare(
        `SELECT * FROM logs WHERE category IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
      ).bind(...categories, limit).all<DBLog>();
      return results || [];
    }
    const { results } = await this.db.prepare(
      "SELECT * FROM logs ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all<DBLog>();
    return results || [];
  }

  /**
   * 清理所有日志
   */
  async clearLogs() {
    await this.db.prepare("DELETE FROM logs").run();
    await this.writeLog("info", "operation", "已手动清空运行日志");
  }

  /**
   * 实时更新域名的解析状态与 NS 标记 (用于 DNS 增删改后精准即时刷新状态)
   */
  async updateDomainStatusAndDns(domainId: number, status: string, hasDns: number, dnsProvider?: string) {
    try {
      const beijingNow = this.getBeijingNow();
      await this.db.prepare(
        "UPDATE domains_cache SET status = ?, has_dns = ?, dns_provider = ?, updated_at = ? WHERE id = ?"
      ).bind(status, hasDns, dnsProvider || (hasDns ? "system" : "external"), beijingNow, domainId).run();
    } catch (e) {
      console.error("Failed to update domain status and dns:", e);
    }
  }

  /**
   * 自动清理过期日志（保留最近 30 天）
   * 
   * NOTE: 在每次 Cron 任务执行后调用此方法，防止日志无限增长
   * 占满 D1 免费版的 500MB 存储限制
   */
  async pruneExpiredLogs() {
    try {
      const result = await this.db.prepare(
        "DELETE FROM logs WHERE created_at < datetime('now', '-30 days')"
      ).run();
      const deletedCount = result.meta?.changes || 0;
      if (deletedCount > 0) {
        await this.writeLog("info", "system", `自动清理了 ${deletedCount} 条超过 30 天的过期日志`);
      }
    } catch (e) {
      console.error("Failed to prune expired logs:", e);
    }
  }

  /**
   * 通过 keys/list 接口校验 API 密钥有效性，并尝试自动解析密钥名称 (key_name) 作为账户别名
   * @returns 解析出的别名；密钥无效时抛出异常；有效但未找到名称时返回 null
   */
  async resolveAliasFromKey(client: DNSHEClient, apiKey: string): Promise<string | null> {
    try {
      const res = await client.listApiKeys();
      if (res && res.success && Array.isArray(res.keys)) {
        const match = res.keys.find((k) => k.api_key === apiKey);
        const keyName = match && match.key_name ? String(match.key_name).trim() : "";
        if (keyName) return keyName;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "未知错误";
      throw new Error(`无法验证 API 密钥有效性: ${message}`);
    }
    return null;
  }

  /**
   * 添加 API 账户
   * alias 可留空，留空时自动通过 keys/list 接口解析密钥名称 (key_name) 作为别名
   */
  async addAccount(alias: string, apiKey: string, apiSecret: string): Promise<DBAccount> {
    const client = new DNSHEClient(apiKey, apiSecret);

    // 别名处理：为空时调用 keys/list 同时完成校验与别名解析（一次请求）
    let finalAlias = (alias || "").trim();
    if (!finalAlias) {
      const resolved = await this.resolveAliasFromKey(client, apiKey);
      if (!resolved) {
        throw new Error("API 密钥有效但未能自动获取密钥名称作为别名，请手动填写别名");
      }
      finalAlias = resolved;
    } else {
      // 显式提供别名时，仍需校验密钥是否可用
      try {
        await client.getQuota();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "未知错误";
        throw new Error(`无法验证 API 密钥有效性: ${message}`);
      }
    }

    const encryptedSecret = await encryptText(apiSecret, this.aesKey);

    // NOTE: 先执行写库（api_key 有 UNIQUE 约束），只有真正入库成功后才写"绑定成功"日志，
    // 避免重复绑定等失败场景下 INSERT 抛异常、成功日志却已落库导致的"失败却显示成功"问题。
    try {
      await this.db.prepare(
        "INSERT INTO accounts (alias, api_key, api_secret) VALUES (?, ?, ?)"
      ).bind(finalAlias, apiKey, encryptedSecret).run();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      // 唯一约束冲突（重复绑定同一 api_key）翻译为友好中文提示
      if (raw.includes("UNIQUE") || raw.toLowerCase().includes("unique constraint")) {
        throw new Error(`该 API Key 已被绑定，请勿重复绑定（别名: ${finalAlias}）`);
      }
      throw new Error(`账户入库失败: ${raw}`);
    }

    const result = await this.db.prepare(
      "SELECT id, alias, api_key, created_at FROM accounts WHERE api_key = ?"
    ).bind(apiKey).first<DBAccount>();

    // 入库成功后再记录日志：区分是否启用了 AES-GCM 加密
    if (!this.aesKey) {
      await this.writeLog("warning", "operation", `账户 [${finalAlias}] 已绑定，但由于未配置 AES_KEY，秘钥将以不安全的方式（弱 Base64 编码）存储在 D1 中！`);
    } else {
      await this.writeLog("success", "operation", `账户 [${finalAlias}] 绑定成功，已启用 AES-GCM 安全加密`);
    }

    return result as DBAccount;
  }

  /**
   * 获取所有账户
   */
  async getAccounts(): Promise<DBAccount[]> {
    const { results } = await this.db.prepare(
      "SELECT id, alias, api_key, created_at FROM accounts ORDER BY id ASC"
    ).all<DBAccount>();
    return results || [];
  }

  /**
   * 更新 API 账户（可仅修改别名，或同时更换 API Key/Secret）
   */
  async updateAccount(id: number, alias: string, apiKey?: string, apiSecret?: string): Promise<DBAccount> {
    const existing = await this.db.prepare(
      "SELECT alias, api_key, api_secret FROM accounts WHERE id = ?"
    ).bind(id).first();
    if (!existing) {
      throw new Error(`未找到 ID 为 ${id} 的账户`);
    }
    const existingRow = existing as { alias: string; api_key: string; api_secret: string };

    const finalAlias = (alias || "").trim() || existingRow.alias;
    let finalApiKey = existingRow.api_key;
    let finalEncryptedSecret = existingRow.api_secret;

    // 若提供了新的 API Key/Secret，则校验有效性并加密替换；留空表示保持不变
    const newKey = (apiKey || "").trim();
    const newSecret = (apiSecret || "").trim();
    if (newKey || newSecret) {
      if (!newKey || !newSecret) {
        throw new Error("更换 API 密钥时，API Key 与 API Secret 必须同时填写");
      }
      const client = new DNSHEClient(newKey, newSecret);
      try {
        await client.getQuota();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "未知错误";
        throw new Error(`无法验证新 API 密钥有效性: ${message}`);
      }
      finalApiKey = newKey;
      finalEncryptedSecret = await encryptText(newSecret, this.aesKey);
    }

    try {
      await this.db.prepare(
        "UPDATE accounts SET alias = ?, api_key = ?, api_secret = ? WHERE id = ?"
      ).bind(finalAlias, finalApiKey, finalEncryptedSecret, id).run();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes("UNIQUE") || raw.toLowerCase().includes("unique constraint")) {
        throw new Error("该 API Key 已被其他账号绑定，请勿重复使用");
      }
      throw new Error(`账户更新失败: ${raw}`);
    }

    const result = await this.db.prepare(
      "SELECT id, alias, api_key, created_at FROM accounts WHERE id = ?"
    ).bind(id).first<DBAccount>();

    await this.writeLog("success", "operation", `账户 [${finalAlias}] 信息已更新`);
    return result as DBAccount;
  }

  /**
   * 删除账户
   */
  async deleteAccount(id: number) {
    const account = await this.db.prepare("SELECT alias FROM accounts WHERE id = ?").bind(id).first();
    const alias = account ? (account as { alias: string }).alias : `ID ${id}`;

    // NOTE: domains_cache 会随账号级联删除，但这些域名的 DNS 记录缓存不会——
    // cache 表里会留下一批永远不会再被读取的孤儿行，直到 366 天兜底 TTL 到期。
    // 必须在删账号之前清，否则级联删完就查不到这些域名的 id 了。
    try {
      await this.db.prepare(
        "DELETE FROM cache WHERE key IN (SELECT 'api_cache:dns:' || id FROM domains_cache WHERE account_id = ?)"
      ).bind(id).run();
    } catch (e) {
      console.error("Failed to purge dns cache for account:", e);
    }

    await this.db.prepare("DELETE FROM accounts WHERE id = ?").bind(id).run();
    await this.writeLog("info", "operation", `解绑了账户 [${alias}]，其名下的域名缓存已被自动级联清理`);
  }

  /**
   * 根据 ID 获取解密后的 API 客户端
   */
  async getClientForAccount(id: number): Promise<{ client: DNSHEClient; alias: string }> {
    const account = await this.db.prepare(
      "SELECT alias, api_key, api_secret FROM accounts WHERE id = ?"
    ).bind(id).first();
    
    if (!account) {
      throw new Error(`未找到 ID 为 ${id} 的账户`);
    }

    const typedAccount = account as { alias: string; api_key: string; api_secret: string };
    const apiSecret = await decryptText(typedAccount.api_secret, this.aesKey);
    return {
      client: new DNSHEClient(typedAccount.api_key, apiSecret),
      alias: typedAccount.alias
    };
  }

  /**
   * 跨账号列出域名（包含所属账户别名），支持搜索与状态过滤
   */
  async getDomains(search = "", status = "", accountId?: number): Promise<DBDomain[]> {
    let query = `
      SELECT d.*, a.alias as account_alias 
      FROM domains_cache d
      LEFT JOIN accounts a ON d.account_id = a.id
      WHERE 1=1
    `;
    const binds: (string | number)[] = [];

    if (search) {
      query += " AND (d.subdomain LIKE ? OR d.rootdomain LIKE ? OR d.full_domain LIKE ?)";
      const searchPattern = `%${search}%`;
      binds.push(searchPattern, searchPattern, searchPattern);
    }

    if (status) {
      query += " AND d.status = ?";
      binds.push(status);
    }

    if (accountId) {
      query += " AND d.account_id = ?";
      binds.push(accountId);
    }

    query += " ORDER BY d.expires_at ASC";

    const { results } = await this.db.prepare(query).bind(...binds).all<DBDomain>();
    return results || [];
  }

  /**
   * 按主键查询单条域名记录
   * 
   * NOTE: 替代原先的 getDomains() + Array.find() 全表扫描模式，
   * 直接使用 WHERE d.id = ? 走主键索引，性能从 O(N) 提升至 O(1)
   */
  async getDomainById(id: number): Promise<DBDomain | null> {
    const result = await this.db.prepare(`
      SELECT d.*, a.alias as account_alias 
      FROM domains_cache d
      LEFT JOIN accounts a ON d.account_id = a.id
      WHERE d.id = ?
    `).bind(id).first<DBDomain>();

    return result || null;
  }

  /**
   * 构造单条域名的 UPSERT 语句
   *
   * NOTE: 只有当调用方带上 dns_state_known（即本次确实拉取到了该域名的解析记录）时，
   * 才允许覆盖已有行的 status / has_dns / dns_provider。否则仅刷新到期时间等注册信息，
   * 保留数据库中已识别出的三态 —— 否则上游 subdomains/list 返回的 active 状态
   * 会把整个账号下的「已委派」域名刷成「已解析 + 系统默认」。
   */
  private buildDomainUpsert(accountId: number, sub: UpstreamSubdomain): D1PreparedStatement {
    let hasDnsVal = 1;
    if (sub.dns_state_known) {
      // 调用方已经读过该域名的真实解析记录，直接采信，不再从注册商层面的 ns1/ns2 反推
      hasDnsVal = sub.has_dns ? 1 : 0;
    } else if (sub.disable_ns_management) {
      hasDnsVal = 0;
    } else if (sub.ns1 || sub.ns2) {
      // 判断 NS 是否为默认 ns1.dnshe.com / ns2.dnshe.com
      const ns1 = (sub.ns1 || "").toLowerCase();
      const ns2 = (sub.ns2 || "").toLowerCase();
      const isDefault = ns1.includes("dnshe.com") || ns2.includes("dnshe.com");
      hasDnsVal = isDefault ? 1 : 0;
    } else if (sub.has_dns !== undefined) {
      hasDnsVal = sub.has_dns ? 1 : 0;
    }
    const dnsProvider = sub.dns_provider ?? null;

    // 解析服务商账号 ID —— 与三态不同，它来自 subdomains/list，任何一次同步都可信，
    // 因此不受 dns_state_known 约束；统一转成字符串存，避免上游在 number / string
    // 之间摇摆时前端比较失配。
    const providerAccountId =
      sub.provider_account_id === undefined || sub.provider_account_id === null
        ? null
        : String(sub.provider_account_id);

    // 解析状态未知时，冲突分支保持数据库中的原值不动
    const dnsStateAssignments = sub.dns_state_known
      ? `status = excluded.status,
            has_dns = excluded.has_dns,
            dns_provider = COALESCE(excluded.dns_provider, domains_cache.dns_provider),`
      : "";

    // 绑定的 status 在「解析状态未知」时只对 INSERT 生效（新行没有旧值可保留）。
    //
    // NOTE: 此时上游给的是注册态（active / Registered），前端会把它显示成「已解析」——
    // 新绑定账号里恰好被限流、没拉到解析记录的域名就会挂上一个假的「已解析 + 系统默认」。
    // 落成中性的「未解析」宁可少报也不误报，下一次同步会纠正过来。
    const statusVal = sub.dns_state_known || THREE_STATE_STATUSES.has(sub.status)
      ? sub.status
      : "未解析";

    return this.db.prepare(`
      INSERT INTO domains_cache (id, account_id, subdomain, rootdomain, full_domain, status, created_at, expires_at, has_dns, dns_provider, provider_account_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        provider_account_id = COALESCE(excluded.provider_account_id, domains_cache.provider_account_id),
        ${dnsStateAssignments}
        created_at = COALESCE(NULLIF(excluded.created_at, ''), domains_cache.created_at),
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).bind(
      sub.id,
      accountId,
      sub.subdomain,
      sub.rootdomain,
      sub.full_domain,
      statusVal,
      sub.created_at || "",
      sub.expires_at || "",
      hasDnsVal,
      dnsProvider,
      providerAccountId,
      this.getBeijingNow()
    );
  }

  /**
   * 写入/更新单条域名缓存（不做账号级别的清理扫描）
   *
   * NOTE: 供在线注册等「只新增一个域名」的场景使用。不能改用 syncAccountDomains，
   * 因为后者会把没出现在入参列表里的域名当作上游已删除而清除。
   */
  async upsertDomain(accountId: number, sub: UpstreamSubdomain): Promise<void> {
    await this.buildDomainUpsert(accountId, sub).run();
  }

  /**
   * 同步单个账号名下的域名到缓存表
   */
  async syncAccountDomains(accountId: number, subdomains: UpstreamSubdomain[]) {
    const statements: D1PreparedStatement[] = [];

    // 1. 获取当前缓存中该账号所有的域名 ID 集合，以便删除在 DNSHE 后台已经被删掉的域名
    const cachedDomains = await this.db.prepare(
      "SELECT id FROM domains_cache WHERE account_id = ?"
    ).bind(accountId).all();
    const cachedIds = new Set((cachedDomains.results || []).map((d: Record<string, unknown>) => d.id as number));
    const activeIds = new Set(subdomains.map(s => s.id));

    // 2. 准备插入/更新操作
    for (const sub of subdomains) {
      statements.push(this.buildDomainUpsert(accountId, sub));
    }

    // 3. 准备删除操作（清理已经被删除的域名）
    // NOTE: 改为每条 DELETE 使用独立的参数化语句，消除动态 SQL 拼接的注入风险
    const deleteIds = [...cachedIds].filter(id => !activeIds.has(id));
    for (const deleteId of deleteIds) {
      statements.push(
        this.db.prepare("DELETE FROM domains_cache WHERE id = ?").bind(deleteId)
      );
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }

  /**
   * 标记域名已续期成功
   */
  async markDomainRenewed(id: number, newExpiresAt: string) {
    const beijingNow = this.getBeijingNow();
    await this.db.prepare(`
      UPDATE domains_cache
      SET expires_at = ?, last_renewed_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(newExpiresAt, beijingNow, beijingNow, id).run();
  }

  /**
   * 从本地缓存中移除一条域名记录（上游删除成功后调用，避免列表残留幽灵条目）
   */
  async deleteDomainFromCache(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM domains_cache WHERE id = ?").bind(id).run();
  }
}
