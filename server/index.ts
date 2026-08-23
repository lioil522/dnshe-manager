/**
 * DNSHE-Manager 自建版入口（Docker / 裸机 Node）
 *
 * 与 Cloudflare 版共用 src/ 下的全部业务代码，这里只补三样 Workers 运行时提供、
 * Node 里没有的东西：
 *   1. env 绑定  —— 用 process.env + 本地 SQLite 组装出与 wrangler.toml 等价的 env，
 *                   通过 app.fetch(request, env, ctx) 注入，因此 src/ 一行都不用改
 *   2. executionCtx.waitUntil —— Node 进程不会被回收，退化成「记录异常的即发即忘」
 *   3. Cron Trigger —— 用定时器在每天 UTC 02:00 调用同一个 runDailySyncAndRenewal
 *
 * 前端由同一个端口以静态文件形式发出（同源），因此不需要配置 CORS。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";

import worker from "../src/index";
import { DatabaseManager } from "../src/db";
import { runDailySyncAndRenewal } from "../src/cron";
import type { WebhookType } from "../src/cron";
import { createD1FromSqlite } from "./d1-sqlite";
import { createStaticHandler } from "./static";

// ===== 配置读取 =====

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, "dnshe.db"));
const SCHEMA_FILE = path.resolve(process.env.SCHEMA_FILE || "./schema.sql");

/**
 * 前端产物目录
 *
 * 未显式指定时按约定探测：镜像里是 /app/public，本地跑 `npm run start:node`
 * 时则是 frontend/dist —— 两种布局都不用配环境变量。
 */
function resolveStaticDir(): string {
  const explicit = (process.env.STATIC_DIR || "").trim();
  if (explicit) return path.resolve(explicit);
  for (const candidate of ["./public", "./frontend/dist"]) {
    const dir = path.resolve(candidate);
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return path.resolve("./public");
}

const STATIC_DIR = resolveStaticDir();

// Cron 触发时刻（UTC）。默认与 wrangler.toml 的 crons = ["0 2 * * *"] 保持一致，
// 即北京时间上午 10 点。
const CRON_UTC_HOUR = Number(process.env.CRON_UTC_HOUR ?? 2);
const CRON_UTC_MINUTE = Number(process.env.CRON_UTC_MINUTE ?? 0);
const CRON_DISABLED = process.env.DISABLE_CRON === "1";

/** 把空字符串归一成 undefined —— docker-compose 里未填的变量会传进空串，
 *  而 src/ 里多处用 `c.env.X || 默认值` 判断「是否配置过」，空串与 undefined 等价，
 *  但类型上保持 undefined 更贴近 Workers 里「secret 未设置」的语义。 */
function optionalEnv(name: string): string | undefined {
  const value = (process.env[name] || "").trim();
  return value ? value : undefined;
}

/**
 * 解析 AES 加密密钥
 *
 * 未通过环境变量提供时，在数据目录里生成并持久化一份随机密钥 —— 与 GitHub Actions
 * 部署路径「未配置则自动生成」的行为一致，避免用户不配 AES_KEY 就退化成弱 Base64
 * 编码存储 API Secret 与 2FA 密钥（见 src/db.ts 的 encryptText）。
 *
 * ⚠️ 这份密钥必须与数据库一起备份：密钥丢了，库里的 API Secret 与 2FA 密钥都解不开。
 */
function resolveAesKey(): { key: string; source: "env" | "file" | "generated" } {
  const fromEnv = optionalEnv("AES_KEY");
  if (fromEnv) return { key: fromEnv, source: "env" };

  const keyFile = path.join(DATA_DIR, "aes.key");
  if (existsSync(keyFile)) {
    const stored = readFileSync(keyFile, "utf8").trim();
    if (stored) return { key: stored, source: "file" };
  }

  const generated = randomBytes(32).toString("hex");
  writeFileSync(keyFile, `${generated}\n`, { mode: 0o600 });
  return { key: generated, source: "generated" };
}

// ===== 数据库初始化 =====

mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(DB_PATH);
// WAL 提升读写并发与崩溃安全性；busy_timeout 兜住极偶发的锁等待。
// NOTE: foreign_keys 在 node:sqlite 里默认就是开启的，与 D1 一致 ——
// src/db.ts 的 deleteAccount() 依赖 domains_cache 的 ON DELETE CASCADE。
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA synchronous = NORMAL");
sqlite.exec("PRAGMA busy_timeout = 5000");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = createD1FromSqlite(sqlite);
const { key: aesKey, source: aesKeySource } = resolveAesKey();

// 建表：先跑 schema.sql（含索引，与 Cloudflare 版 d1 execute 的产物一致），
// 再走 ensureTables()（补 settings 表与历史库的字段迁移）。两者都是幂等的。
if (existsSync(SCHEMA_FILE)) {
  sqlite.exec(readFileSync(SCHEMA_FILE, "utf8"));
} else {
  console.warn(`[warn] 未找到 schema.sql（${SCHEMA_FILE}），将只建表不建索引`);
}

const env = {
  DB: db,
  AES_KEY: aesKey,
  WEBHOOK_URL: optionalEnv("WEBHOOK_URL"),
  WEBHOOK_TYPE: optionalEnv("WEBHOOK_TYPE"),
  ADMIN_TOKEN: optionalEnv("ADMIN_TOKEN"),
  ALLOWED_ORIGIN: optionalEnv("ALLOWED_ORIGIN"),
  DEFAULT_API_KEY: optionalEnv("DEFAULT_API_KEY"),
  DEFAULT_API_SECRET: optionalEnv("DEFAULT_API_SECRET"),
  DEFAULT_API_ALIAS: optionalEnv("DEFAULT_API_ALIAS"),
};

await new DatabaseManager(db, aesKey).ensureTables();

// ===== ExecutionContext 替身 =====

/**
 * Workers 用 waitUntil 保证请求返回后异步任务不被回收；Node 进程一直活着，
 * 直接放任 Promise 跑完即可。唯一要做的是接住异常 —— Node 会因未处理的
 * Promise 拒绝直接退出进程，一个后台同步任务报错不该把整个面板带走。
 */
const executionCtx = {
  waitUntil(promise: Promise<unknown>): void {
    void Promise.resolve(promise).catch((e) => {
      console.error("[waitUntil] 后台任务失败：", e);
    });
  },
  passThroughOnException(): void {
    /* Workers 专属语义，Node 下无对应行为 */
  },
  props: {},
} as unknown as ExecutionContext;

// ===== 请求分流 =====

const handleStatic = createStaticHandler(STATIC_DIR);

async function fetchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // /api/* 交给业务 Worker（src/index.ts 里所有路由都挂在这个前缀下）
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return (await worker.fetch(request, env, executionCtx)) as Response;
  }

  // 容器健康检查：顺带读一次数据库，能区分「进程活着」与「数据库可读」
  if (url.pathname === "/healthz") {
    try {
      sqlite.prepare("SELECT 1 AS ok").get();
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return Response.json({ ok: false, message }, { status: 503 });
    }
  }

  return handleStatic(request);
}

// ===== 定时任务 =====

let cronTimer: NodeJS.Timeout | null = null;

function msUntilNextUtc(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0)
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/** 格式化成北京时间，只用于日志可读性 */
function toBeijingText(date: Date): string {
  return new Date(date.getTime() + 8 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

function scheduleCron(): void {
  const delay = msUntilNextUtc(CRON_UTC_HOUR, CRON_UTC_MINUTE);
  console.log(`[cron] 下一次域名同步与自动续期：${toBeijingText(new Date(Date.now() + delay))}（北京时间）`);

  cronTimer = setTimeout(() => {
    void (async () => {
      try {
        const webhookType = (env.WEBHOOK_TYPE || "custom") as WebhookType;
        await runDailySyncAndRenewal(new DatabaseManager(db, aesKey), env.WEBHOOK_URL, webhookType);
      } catch (e) {
        console.error("[cron] 定时任务执行失败：", e);
      } finally {
        // 无论成败都要排下一次，否则一次异常就等于永久停摆
        scheduleCron();
      }
    })();
  }, delay);
}

// ===== 启动 =====

const server = serve({ fetch: fetchHandler, hostname: HOST, port: PORT }, (info) => {
  console.log(`DNSHE-Manager 自建版已启动：http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${info.port}`);
  console.log(`  数据库    ${DB_PATH}`);
  console.log(`  前端产物  ${STATIC_DIR}`);
  console.log(
    `  加密密钥  ${
      aesKeySource === "env"
        ? "来自环境变量 AES_KEY"
        : aesKeySource === "file"
        ? `来自 ${path.join(DATA_DIR, "aes.key")}`
        : `已自动生成并写入 ${path.join(DATA_DIR, "aes.key")}`
    }`
  );
  if (aesKeySource !== "env") {
    console.warn("  ⚠️  请把整个数据目录（含 aes.key）一起备份：密钥丢失将无法解密已存的 API Secret 与 2FA 密钥");
  }
  if (CRON_DISABLED) {
    console.log("[cron] 已通过 DISABLE_CRON=1 关闭定时任务");
  }
});

if (!CRON_DISABLED) {
  scheduleCron();
}

// 启动期最常见的失败是端口被占用，默认会抛一整屏 Node 栈；换成一句能照着做的提示
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n端口 ${PORT} 已被占用。换个端口（环境变量 PORT，或改 docker-compose.yml 的 ports），或先停掉占用它的进程。`);
    process.exit(1);
  }
  if (e.code === "EACCES") {
    console.error(`\n没有权限监听端口 ${PORT}。1024 以下的端口需要 root，建议保留默认 8787，再用反向代理对外。`);
    process.exit(1);
  }
  console.error("HTTP 服务出错：", e);
  process.exit(1);
});

// 后台任务（同步 / 续期）里漏网的异常不应该终止进程
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] 未处理的 Promise 拒绝：", reason);
});

// ===== 优雅退出 =====

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在退出…`);

  if (cronTimer) clearTimeout(cronTimer);

  // 兜底：连接迟迟不断开时也要让容器按时停下（docker stop 默认只等 10 秒）
  const force = setTimeout(() => {
    console.warn("等待连接关闭超时，强制退出");
    try {
      sqlite.close();
    } catch {
      /* 忽略关闭期异常 */
    }
    process.exit(0);
  }, 8000);

  server.close(() => {
    clearTimeout(force);
    try {
      // WAL 落盘后再关闭，避免容器被杀时留下未合并的 -wal 文件
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      sqlite.close();
    } catch (e) {
      console.error("关闭数据库时出错：", e);
    }
    console.log("已停止");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
