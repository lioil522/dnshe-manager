import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { DatabaseManager, timingSafeEqual } from "./db";
import { DNSHEClient } from "./dnshe";
import type { CreateDnsRecordParams } from "./dnshe";
import { runDailySyncAndRenewal, fetchAllSubdomainsFromClient, sendTelegramNotification } from "./cron";
import { toASCII } from "./punycode";

/**
 * 统一成功响应封装 — 将 payload 扁平化后附加 success: true，
 * 与前端 data.success / data.accounts / data.message 等取值约定保持一致
 */
function successRes(payload: Record<string, unknown> = {}) {
  return { success: true, ...payload };
}

/**
 * 统一失败响应封装 — 附加 success: false、错误消息与可选错误码 (error_code)
 */
function errorRes(message: string, errorCode?: string) {
  const res: Record<string, unknown> = { success: false, message };
  if (errorCode) {
    res.error_code = errorCode;
  }
  return res;
}

type Bindings = {
  DB: D1Database;
  AES_KEY?: string;
  WEBHOOK_URL?: string;
  WEBHOOK_TYPE?: string;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
  DEFAULT_API_KEY?: string;
  DEFAULT_API_SECRET?: string;
  DEFAULT_API_ALIAS?: string;
};

// NOTE: 深度同步单个账号的域名缓存 — 逐个拉取每个域名的 DNS 记录，自动分类（已委派/已解析/未解析）
// 与 cron.ts 中 "同步所有域名" 的逻辑保持一致，供绑定/批量/修改换 Key 后调用
async function deepSyncAccountDomains(dbManager: DatabaseManager, accountId: number, client: DNSHEClient): Promise<number> {
  const subdomains = await fetchAllSubdomainsFromClient(client);

  // 并发拉取每个子域名的 DNS 记录，自动计算真实状态
  const enriched = await Promise.all(
    subdomains.map(async (sub) => {
      try {
        const recordsRes = await client.listDnsRecords(sub.id);
        const records = recordsRes.records || [];
        const customNsRecord = records.find(
          (r) => r.type === "NS" && !String(r.content || "").toLowerCase().includes("dnshe.com")
        );

        let computedStatus = sub.status;
        let hasDnsVal = 1;
        if (customNsRecord) {
          computedStatus = "已委派";
          hasDnsVal = 0;
        } else if (records.length > 0) {
          computedStatus = "已解析";
          hasDnsVal = 1;
        } else {
          computedStatus = "未解析";
          hasDnsVal = 1;
        }

        // 深度同步拿到的真实解析记录一并回填缓存，后续打开 DNS 面板直接命中、零上游调用
        await dbManager.setCache(`api_cache:dns:${sub.id}`, JSON.stringify(records));

        return { ...sub, status: computedStatus, has_dns: hasDnsVal };
      } catch (e: unknown) {
        console.error(`listDnsRecords failed for subdomain ${sub.id}:`, e);
        return { ...sub, has_dns: 1 };
      }
    })
  );

  if (enriched.length > 0) {
    await dbManager.syncAccountDomains(accountId, enriched);
  }
  return subdomains.length;
}

// NOTE: 批量绑定后逐个账号深度同步域名（间隔 1.2s 规避 DNSHE 速率限制）
async function syncDomainsForAccounts(dbManager: DatabaseManager, accountIds: number[]) {
  for (const id of accountIds) {
    try {
      const { client } = await dbManager.getClientForAccount(id);
      const synced = await deepSyncAccountDomains(dbManager, id, client);
      console.log(`Deep sync finished for account ${id}: ${synced} domains`);
    } catch (e: unknown) {
      console.error(`Background domain deep sync failed for account ${id}:`, e);
    }
    await sleep(1200);
  }
}

// NOTE: 简易异步等待工具
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NOTE: 辅助函数 - 如果在环境变量中配置了 DEFAULT_API_KEY 和 DEFAULT_API_SECRET，自动进行初始化绑定
async function ensureDefaultAccount(c: any, dbManager: DatabaseManager) {
  const apiKey = c.env.DEFAULT_API_KEY;
  const apiSecret = c.env.DEFAULT_API_SECRET;
  const alias = c.env.DEFAULT_API_ALIAS || "默认账号 (环境变量)";

  if (apiKey && apiSecret) {
    try {
      const existingAccounts = await dbManager.getAccounts();
      const exists = existingAccounts.some(acc => acc.api_key === apiKey);
      if (!exists) {
        const newAcc = await dbManager.addAccount(alias, apiKey, apiSecret);
        // 深度同步一次域名，保证自动分类（已委派/已解析/未解析）
        try {
          const { client } = await dbManager.getClientForAccount(newAcc.id);
          await deepSyncAccountDomains(dbManager, newAcc.id, client);
        } catch (syncErr) {
          console.error("Default account auto-sync failed:", syncErr);
        }
      }
    } catch (e) {
      console.error("Auto registration of default account failed:", e);
    }
  }
}

// NOTE: 扩展 Hono 上下文变量，使中间件注入的 dbManager 可在路由中安全访问
type Variables = {
  db: DatabaseManager;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * CORS 中间件 — 默认仅允许同源访问，生产环境通过 ALLOWED_ORIGIN 环境变量配置
 * 
 * NOTE: 不再使用 origin: "*"，避免任意域名跨域调用管理 API
 */
app.use(
  "/api/*",
  async (c, next) => {
    const origin = c.req.header("Origin") || "*";
    
    // 强制直接响应 CORS OPTIONS 预检请求，避免跨域报错
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const corsMiddleware = cors({
      origin: c.env.ALLOWED_ORIGIN || origin,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    });
    return corsMiddleware(c, next);
  }
);

/**
 * 标准 Base32 解码辅助函数
 */
function base32ToUint8Array(base32: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let index = 0;

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output.slice(0, index);
}

/**
 * 生成随机 Base32 编码的 TOTP 密钥（默认 20 字节 = 160 位，符合 RFC 4226 建议）
 */
function generateBase32Secret(byteLength = 20): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * 构建标准 otpauth:// URI，供前端生成二维码，导入 Google / Microsoft Authenticator
 */
function buildOtpAuthUri(secret: string, account: string, issuer = "DNSHE Manager"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * 校验 6 位 TOTP (2FA 动态口令) 是否有效
 * 自动识别 Base32 编码密钥，支持 ±60 秒 (±2 时间步长) 的系统时钟倾斜容差
 */
/**
 * 校验 6 位 TOTP (2FA 动态口令) 是否有效
 * 自动识别 Base32 编码密钥，支持 ±60 秒 (±2 时间步长) 的系统时钟倾斜容差
 */
async function verifyTOTP(token?: string, secretStr?: string): Promise<boolean> {
  if (!token || !secretStr) return false;

  const cleanToken = String(token).trim();
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const cleanSecret = String(secretStr).trim();
  if (!cleanSecret) return false;

  // 构建两种秘钥尝试 (1: Base32 解码秘钥; 2: UTF-8 原始文本秘钥)
  const keyCandidates: Uint8Array[] = [];

  if (/^[A-Z2-7=]+$/i.test(cleanSecret)) {
    keyCandidates.push(base32ToUint8Array(cleanSecret));
  }
  keyCandidates.push(new TextEncoder().encode(cleanSecret));

  const nowSec = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  const currentT = Math.floor(nowSec / timeStep);

  for (const keyData of keyCandidates) {
    if (keyData.length === 0) continue;
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
      );

      // 容忍 ±1 窗口 (±30秒)，精准标准时间步容差
      for (let i = -1; i <= 1; i++) {
        const t = currentT + i;
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setBigUint64(0, BigInt(t), false);

        const signature = await crypto.subtle.sign("HMAC", cryptoKey, buffer);
        const hmacBytes = new Uint8Array(signature);

        const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
        const binary =
          ((hmacBytes[offset] & 0x7f) << 24) |
          ((hmacBytes[offset + 1] & 0xff) << 16) |
          ((hmacBytes[offset + 2] & 0xff) << 8) |
          (hmacBytes[offset + 3] & 0xff);

        const otp = (binary % 1000000).toString().padStart(6, "0");
        if (otp === cleanToken) {
          return true;
        }
      }
    } catch (e) {
      console.error("TOTP verification attempt error:", e);
    }
  }

  return false;
}

/**
 * DatabaseManager 实例化中间件 — 注入 dbManager 到 context
 */
app.use("/api/*", async (c, next) => {
  const dbManager = new DatabaseManager(c.env.DB, c.env.AES_KEY);
  await dbManager.ensureTables();
  c.set("db", dbManager);
  return next();
});

/**
 * 0-a. 鉴权状态查询接口 — 供前端登录页判断是否需要首次设置密码 / 是否要求 2FA (公开接口)
 */
app.get("/api/auth/status", async (c) => {
  const dbManager = c.get("db");
  try {
    const cfg = await dbManager.getAuthConfig();
    return c.json(successRes({
      initialized: cfg.initialized,      // 是否已完成首次密码设置
      two_fa_enabled: cfg.twoFaEnabled,  // 登录是否需要 2FA 动态码
    }));
  } catch (e: any) {
    return c.json(errorRes(`读取鉴权状态失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

/**
 * 0-b. 首次初始化接口 — 系统未设置过密码时，允许自行设定管理员用户名与密码 (公开接口，仅在未初始化时可用)
 */
app.post("/api/auth/setup", async (c) => {
  const dbManager = c.get("db");
  try {
    const cfg = await dbManager.getAuthConfig();
    if (cfg.initialized) {
      return c.json(errorRes("系统已完成初始化，无法再次通过此接口设置密码", "already_initialized"), 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || username.length < 3) {
      return c.json(errorRes("用户名至少需要 3 个字符", "bad_request"), 400);
    }
    if (password.length < 8) {
      return c.json(errorRes("密码至少需要 8 个字符", "bad_request"), 400);
    }

    await dbManager.setPassword(username, password);
    await dbManager.writeLog("success", "auth", `系统完成首次初始化，已创建管理员账户 [${username}]`);

    // 初始化后直接签发 Session，免去再登录一次
    const sessionToken = `dnshe_sess_${crypto.randomUUID()}`;
    await dbManager.setSetting(`sess_${sessionToken}`, "valid");

    return c.json(successRes({
      session_token: sessionToken,
      message: "🎉 初始化成功！管理员账户已创建并自动登录",
    }));
  } catch (e: any) {
    console.error("Setup process error:", e);
    return c.json(errorRes(`初始化失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

/**
 * 0-c. 登录接口 — 用户名 + 密码为主，若开启 2FA 则额外校验 6 位动态码，成功后换取 Session Token (公开接口)
 */
app.post("/api/auth/login", async (c) => {
  const dbManager = c.get("db");
  const emergencyToken = c.env.ADMIN_TOKEN || "";

  try {
    const cfg = await dbManager.getAuthConfig();
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const totpToken = String(body.token || "").trim();

    // 尚未初始化：引导前端走首次设置流程
    if (!cfg.initialized) {
      return c.json(errorRes("系统尚未初始化，请先设置管理员账户与密码", "not_initialized"), 409);
    }

    // 应急令牌通道：单独用 ADMIN_TOKEN（静态或其 TOTP）直接登录，用于忘记密码时找回
    if (emergencyToken && !username && (totpToken || password)) {
      const candidate = totpToken || password;
      const emgTotpValid = await verifyTOTP(candidate, emergencyToken);
      if (emgTotpValid || timingSafeEqual(candidate, emergencyToken)) {
        const sessionToken = `dnshe_sess_${crypto.randomUUID()}`;
        await dbManager.setSetting(`sess_${sessionToken}`, "valid");
        await dbManager.writeLog("warning", "auth", "管理员通过应急令牌 (ADMIN_TOKEN) 登录");
        return c.json(successRes({
          session_token: sessionToken,
          message: "已通过应急令牌登录，建议尽快在设置中重置密码",
        }));
      }
    }

    if (!username || !password) {
      return c.json(errorRes("请输入用户名与密码", "bad_request"), 400);
    }

    // 1. 校验用户名 + 密码
    const userMatch = timingSafeEqual(username, cfg.username);
    const passMatch = await dbManager.verifyPassword(password);
    if (!userMatch || !passMatch) {
      await dbManager.writeLog("warning", "auth", `管理员登录失败：用户名或密码错误 (输入用户名: ${username})`);
      return c.json(errorRes("用户名或密码错误", "invalid_credentials"), 401);
    }

    // 2. 若开启 2FA，则要求校验动态码
    if (cfg.twoFaEnabled) {
      if (!totpToken) {
        // 密码正确但缺少动态码：提示前端补充 2FA 输入
        return c.json(errorRes("请输入 6 位动态验证码", "need_2fa"), 401);
      }
      const totpValid = await verifyTOTP(totpToken, cfg.twoFaSecret);
      if (!totpValid) {
        await dbManager.writeLog("warning", "auth", "管理员登录失败：2FA 动态验证码错误或已过期");
        return c.json(errorRes("2FA 动态验证码错误或已过期", "invalid_2fa"), 401);
      }
    }

    // 3. 全部通过，签发长期 Session Token
    const sessionToken = `dnshe_sess_${crypto.randomUUID()}`;
    await dbManager.setSetting(`sess_${sessionToken}`, "valid");
    await dbManager.writeLog("success", "auth", `管理员 [${username}] 登录成功${cfg.twoFaEnabled ? "（含 2FA 校验）" : ""}`);

    return c.json(successRes({
      session_token: sessionToken,
      message: "🎉 登录成功",
    }));
  } catch (e: any) {
    console.error("Login process error:", e);
    return c.json(errorRes(`登录鉴权失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

/**
 * 鉴权中间件 — 验证受保护 API 的 Session 会话 Token
 *
 * NOTE: 公开接口（登录 / 初始化 / 状态查询）显式放行；
 * 其余接口一律要求携带登录成功后签发的 Session Token（或应急令牌）。
 */
app.use("/api/*", async (c, next) => {
  const publicPaths = ["/api/auth/login", "/api/auth/setup", "/api/auth/status"];
  if (publicPaths.includes(c.req.path)) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(errorRes("未提供有效的 Authorization 头部，格式应为: Bearer <session_token>", "unauthorized"), 401);
  }

  const token = authHeader.substring(7).trim();
  const dbManager = c.get("db");
  const emergencyToken = c.env.ADMIN_TOKEN || "";

  // 1. 校验登录成功后签发的 Session Token
  if (token.startsWith("dnshe_sess_")) {
    try {
      const storedSess = await dbManager.getSetting(`sess_${token}`);
      if (storedSess === "valid") {
        return next();
      }
    } catch (e) {}
  }

  // 2. 应急令牌通道：允许直接用 ADMIN_TOKEN（静态或其 TOTP）访问，用于登录系统异常时的兜底
  if (emergencyToken) {
    if (timingSafeEqual(token, emergencyToken) || await verifyTOTP(token, emergencyToken)) {
      return next();
    }
  }

  return c.json(errorRes("认证失败：会话凭据已失效，请重新登录", "forbidden"), 403);
});

/**
 * 账户安全 API — 修改密码与 2FA 开关（均需已登录）
 */

// A1. 读取当前账户安全状态（用户名 + 2FA 是否开启）
app.get("/api/auth/account", async (c) => {
  const dbManager = c.get("db");
  try {
    const cfg = await dbManager.getAuthConfig();
    return c.json(successRes({
      username: cfg.username,
      two_fa_enabled: cfg.twoFaEnabled,
    }));
  } catch (e: any) {
    return c.json(errorRes(`读取账户信息失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

// A2. 修改密码（需校验旧密码）
app.post("/api/auth/change-password", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    const oldPassword = String(body.old_password || "");
    const newPassword = String(body.new_password || "");
    const newUsername = body.username !== undefined ? String(body.username).trim() : undefined;

    const cfg = await dbManager.getAuthConfig();

    const oldValid = await dbManager.verifyPassword(oldPassword);
    if (!oldValid) {
      await dbManager.writeLog("warning", "auth", "修改密码失败：原密码校验不通过");
      return c.json(errorRes("原密码错误", "invalid_credentials"), 401);
    }
    if (newPassword.length < 8) {
      return c.json(errorRes("新密码至少需要 8 个字符", "bad_request"), 400);
    }
    if (newUsername !== undefined && newUsername.length > 0 && newUsername.length < 3) {
      return c.json(errorRes("用户名至少需要 3 个字符", "bad_request"), 400);
    }

    const finalUsername = (newUsername && newUsername.length >= 3) ? newUsername : cfg.username;
    await dbManager.setPassword(finalUsername, newPassword);
    await dbManager.writeLog("success", "auth", `管理员 [${finalUsername}] 修改了登录密码`);

    return c.json(successRes({ message: "密码修改成功，请使用新密码重新登录" }));
  } catch (e: any) {
    console.error("Change password error:", e);
    return c.json(errorRes(`修改密码失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

// A3. 生成待启用的 2FA 密钥与二维码 URI（不立即开启，需下一步验证）
app.post("/api/auth/2fa/setup", async (c) => {
  const dbManager = c.get("db");
  try {
    const cfg = await dbManager.getAuthConfig();
    const secret = generateBase32Secret();
    // 暂存待启用密钥（加密），开启前不置 enabled 标志
    await dbManager.setTwoFaSecret(secret);
    const otpauthUri = buildOtpAuthUri(secret, cfg.username);
    return c.json(successRes({
      secret,
      otpauth_uri: otpauthUri,
      message: "请用身份验证器扫码或手动录入密钥，然后输入动态码完成开启",
    }));
  } catch (e: any) {
    console.error("2FA setup error:", e);
    return c.json(errorRes(`生成 2FA 密钥失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

// A4. 用一次动态码验证后正式开启 2FA
app.post("/api/auth/2fa/enable", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) {
      return c.json(errorRes("请输入身份验证器上的 6 位动态码", "bad_request"), 400);
    }

    const cfg = await dbManager.getAuthConfig();
    if (!cfg.twoFaSecret) {
      return c.json(errorRes("尚未生成 2FA 密钥，请先执行密钥生成步骤", "bad_request"), 400);
    }

    const valid = await verifyTOTP(token, cfg.twoFaSecret);
    if (!valid) {
      return c.json(errorRes("动态码校验失败，请确认时间同步后重试", "invalid_2fa"), 401);
    }

    await dbManager.setTwoFaEnabled(true);
    await dbManager.writeLog("success", "auth", "管理员已开启两步验证 (2FA)");
    return c.json(successRes({ message: "🎉 两步验证已开启，下次登录需输入动态码" }));
  } catch (e: any) {
    console.error("2FA enable error:", e);
    return c.json(errorRes(`开启 2FA 失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

// A5. 关闭 2FA（需校验当前动态码）
app.post("/api/auth/2fa/disable", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) {
      return c.json(errorRes("请输入身份验证器上的 6 位动态码", "bad_request"), 400);
    }

    const cfg = await dbManager.getAuthConfig();
    if (!cfg.twoFaEnabled || !cfg.twoFaSecret) {
      return c.json(errorRes("两步验证当前未开启", "bad_request"), 400);
    }

    const totpValid = await verifyTOTP(token, cfg.twoFaSecret);
    if (!totpValid) {
      await dbManager.writeLog("warning", "auth", "关闭 2FA 失败：动态验证码错误或已过期");
      return c.json(errorRes("动态验证码错误或已过期，无法关闭 2FA", "invalid_2fa"), 401);
    }

    await dbManager.setTwoFaEnabled(false);
    await dbManager.writeLog("warning", "auth", "管理员已关闭两步验证 (2FA)");
    return c.json(successRes({ message: "两步验证已关闭" }));
  } catch (e: any) {
    console.error("2FA disable error:", e);
    return c.json(errorRes(`关闭 2FA 失败: ${e?.message || "服务端内部错误"}`), 500);
  }
});

/**
 * 账号管理 API
 */

// 1. 列出所有绑定的账号
app.get("/api/accounts", async (c) => {
  const dbManager = c.get("db");
  try {
    await ensureDefaultAccount(c, dbManager);
    const accounts = await dbManager.getAccounts();
    return c.json(successRes({ accounts }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

// 2. 绑定新账号（alias 可选，留空时自动从 API Key 解析密钥名称作为别名）
app.post("/api/accounts", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json();
    const { alias, api_key, api_secret } = body;
    
    if (!api_key || !api_secret) {
      return c.json(errorRes("参数缺失：api_key, api_secret 为必填项（alias 可选，留空将自动解析）", "bad_request"), 400);
    }

    const newAccount = await dbManager.addAccount(String(alias || "").trim(), String(api_key), String(api_secret));
    
    // 绑定成功后，后台深度同步该账号域名（逐个拉取 DNS 记录自动分类），不阻塞响应
    if (newAccount && newAccount.id) {
      c.executionCtx.waitUntil(syncDomainsForAccounts(dbManager, [newAccount.id]));
    }

    return c.json(successRes({ account: newAccount }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 3. 批量绑定新账号（仅需 API Key + API Secret，别名留空自动解析）
app.post("/api/accounts/batch", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    const items = Array.isArray(body.accounts) ? body.accounts : [];
    if (items.length === 0) {
      return c.json(errorRes("请至少提供一条账号信息（api_key + api_secret）", "bad_request"), 400);
    }
    if (items.length > 50) {
      return c.json(errorRes("单次最多批量绑定 50 个账号", "bad_request"), 400);
    }

    const results: Array<{ api_key: string; alias?: string; success: boolean; message: string }> = [];
    const newAccountIds: number[] = [];
    let successCount = 0;
    let failCount = 0;

    // 串行处理每个账号，间隔 800ms 以规避 DNSHE 速率限制（默认 30-60 请求/分钟）
    for (const item of items) {
      const apiKey = String(item?.api_key || "").trim();
      const apiSecret = String(item?.api_secret || "").trim();
      const alias = String(item?.alias || "").trim();

      if (!apiKey || !apiSecret) {
        failCount++;
        results.push({ api_key: apiKey || "(未填写)", success: false, message: "缺少 API Key 或 API Secret" });
        continue;
      }

      try {
        const newAccount = await dbManager.addAccount(alias, apiKey, apiSecret);
        newAccountIds.push(newAccount.id);
        successCount++;
        results.push({ api_key: apiKey, alias: newAccount.alias, success: true, message: "绑定成功" });
      } catch (e: unknown) {
        failCount++;
        const message = e instanceof Error ? e.message : "未知错误";
        results.push({ api_key: apiKey, success: false, message });
      }

      await sleep(800);
    }

    // 绑定完成后在后台逐个同步域名（间隔 1.2s 限频），不阻塞 HTTP 响应
    if (newAccountIds.length > 0) {
      c.executionCtx.waitUntil(syncDomainsForAccounts(dbManager, newAccountIds));
    }

    return c.json(successRes({
      success_count: successCount,
      fail_count: failCount,
      results,
      message: `批量绑定完成：成功 ${successCount} 个，失败 ${failCount} 个，域名同步已在后台进行中`,
    }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(`批量绑定失败: ${message}`), 400);
  }
});

// 4. 修改账号信息（可仅改别名，或同时更换 API Key/Secret）
app.put("/api/accounts/:id", async (c) => {
  const dbManager = c.get("db");
  const id = parseInt(c.req.param("id"), 10);
  try {
    const body = await c.req.json().catch(() => ({}));
    const alias = String(body.alias || "");
    const apiKey = body.api_key !== undefined ? String(body.api_key) : undefined;
    const apiSecret = body.api_secret !== undefined ? String(body.api_secret) : undefined;

    const updatedAccount = await dbManager.updateAccount(id, alias, apiKey, apiSecret);

    // 若更换了 API Key，则后台深度重新同步该账号的域名缓存（拉取 DNS 记录自动分类）
    if (apiKey && apiSecret) {
      c.executionCtx.waitUntil(syncDomainsForAccounts(dbManager, [updatedAccount.id]));
    }

    return c.json(successRes({ account: updatedAccount, message: "账号信息已更新" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 5. 解绑账号
app.delete("/api/accounts/:id", async (c) => {
  const dbManager = c.get("db");
  const id = parseInt(c.req.param("id"), 10);
  try {
    await dbManager.deleteAccount(id);
    return c.json(successRes({ message: "账户解绑成功" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 域名管理 API
 */

// 1. 跨账号列出所有域名
app.get("/api/domains", async (c) => {
  const dbManager = c.get("db");
  const search = c.req.query("search") || "";
  const status = c.req.query("status") || "";
  const accountIdStr = c.req.query("account_id");
  const accountId = accountIdStr ? parseInt(accountIdStr, 10) : undefined;

  try {
    const domains = await dbManager.getDomains(search, status, accountId);
    return c.json(successRes({ domains }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

// 2. 立即全量同步所有账号的域名
app.post("/api/domains/sync", async (c) => {
  const dbManager = c.get("db");
  try {
    // 异步执行同步以防止 HTTP 响应超时 (Cloudflare Worker 允许在 waitUntil 里跑异步)
    const webhookType = (c.env.WEBHOOK_TYPE || "custom") as "dingtalk" | "feishu" | "wecom" | "custom";
    c.executionCtx.waitUntil(runDailySyncAndRenewal(dbManager, c.env.WEBHOOK_URL, webhookType));
    return c.json(successRes({ message: "域名同步后台任务已启动，请稍后刷新查看最新数据" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

// 3. 手动续期子域名
app.post("/api/domains/:id/renew", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);

  try {
    // NOTE: 使用 getDomainById 按主键索引查询单条记录，取代原先全表 getDomains() + Array.find()
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未在缓存中找到该域名的记录，请先同步数据", "not_found"), 404);
    }

    const { client, alias } = await dbManager.getClientForAccount(domainInfo.account_id);
    
    const res = await client.renewSubdomain(domainId);
    if (res && res.success) {
      const newExpiresAt = res.new_expires_at || "";
      await dbManager.markDomainRenewed(domainId, newExpiresAt);

      const msg = `域名 [${domainInfo.full_domain}] (账户: ${alias}) 手动续期成功！新有效期至: ${newExpiresAt}`;
      await dbManager.writeLog("success", "api", msg, res);
      // 续期可能影响配额，回源刷新配额缓存，保证后续读操作命中最新数据
      try {
        const { accounts, quotas } = await fetchAllQuotas(dbManager);
        if (accounts.length > 0) {
          await dbManager.setCache("api_cache:quota", JSON.stringify(quotas));
        }
      } catch (e) {
        console.error("续期后刷新配额缓存失败:", e);
      }
      
      return c.json(successRes({ message: "续期成功", new_expires_at: newExpiresAt }));
    } else {
      throw new Error(res.message || "续期请求失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 3.5 删除子域名 (代理接口)
 *
 * ⚠️ 上游对删除有硬限制，以下情形一律拒绝，且限制不可绕过：
 *   1. 域名存在 DNS 解析记录历史；
 *   2. 域名处于「转赠 / ServerHold / PendingDelete」等特殊状态。
 *
 * 因此这里做两道防线：
 *   - 事前拦截：先查状态与解析记录，命中限制直接返回可读原因，不浪费上游调用；
 *   - 事后兜底：上游仍拒绝时，把它的英文错误翻译成中文原因回传前端。
 *
 * 需前端传入 confirm_domain（完整域名）二次确认，防止误删。
 */

/** 不允许删除的域名状态 → 中文原因 */
const UNDELETABLE_STATUS: Record<string, string> = {
  serverhold: "域名处于 ServerHold（服务器暂停）状态",
  pendingdelete: "域名处于 PendingDelete（等待删除）状态",
  transferring: "域名处于转赠 / 转移中状态",
  transfer: "域名处于转赠 / 转移中状态",
  gifting: "域名处于转赠中状态",
  pendingtransfer: "域名处于等待转赠状态",
};

/** 把上游返回的英文限制原因翻译为中文（未知原因原样透传） */
function translateDeleteError(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("dns") && (s.includes("record") || s.includes("history"))) {
    return "该域名存在 DNS 解析记录历史，上游不允许删除";
  }
  if (s.includes("serverhold")) return "域名处于 ServerHold 状态，不支持删除";
  if (s.includes("pendingdelete") || s.includes("pending delete")) {
    return "域名处于 PendingDelete 状态，不支持删除";
  }
  if (s.includes("transfer") || s.includes("gift")) {
    return "域名处于转赠 / 转移状态，不支持删除";
  }
  return raw || "上游拒绝了删除请求";
}

app.post("/api/domains/:id/delete", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);

  if (!Number.isInteger(domainId) || domainId <= 0) {
    return c.json(errorRes("无效的域名 ID", "bad_request"), 400);
  }

  try {
    let confirmDomain = "";
    try {
      const body = await c.req.json();
      confirmDomain = String(body?.confirm_domain || "").trim();
    } catch {
      // 允许空 body，下方统一按"未确认"处理
    }

    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未在缓存中找到该域名的记录，请先同步数据", "not_found"), 404);
    }

    // 二次确认：必须回填完整域名，避免误删（中文域名两种写法都接受）
    const expected = domainInfo.full_domain.toLowerCase();
    const got = toASCII(confirmDomain).toLowerCase();
    if (!got || (got !== expected && confirmDomain.toLowerCase() !== expected)) {
      return c.json(
        errorRes("删除前必须输入完整域名进行确认", "confirm_required"),
        400
      );
    }

    // ── 防线一：状态检查 ──
    const statusKey = String(domainInfo.status || "").toLowerCase().replace(/[\s_-]/g, "");
    for (const [bad, reason] of Object.entries(UNDELETABLE_STATUS)) {
      if (statusKey.includes(bad)) {
        return c.json(errorRes(`${reason}，不支持删除操作`, "delete_forbidden"), 409);
      }
    }

    const { client, alias } = await dbManager.getClientForAccount(domainInfo.account_id);

    // ── 防线二：解析记录历史检查 ──
    // 只要当前仍存在解析记录就直接拦截；"历史"记录无法从 API 读取，
    // 交由上游判定（失败时走 translateDeleteError 翻译）。
    try {
      const dnsRes = await client.listDnsRecords(domainId);
      const records = dnsRes?.records || [];
      if (records.length > 0) {
        return c.json(
          errorRes(
            `该域名存在 ${records.length} 条 DNS 解析记录，存在解析记录历史的域名不支持删除。请先删除全部解析记录后重试（若仍失败则说明上游保留了历史记录，无法删除）`,
            "delete_forbidden"
          ),
          409
        );
      }
    } catch (e) {
      // 解析记录查询失败不阻断，交由上游最终裁决
      console.error("删除前检查 DNS 记录失败，转由上游裁决:", e);
    }

    const res = await client.deleteSubdomain(domainId);
    if (res && res.success) {
      // 上游删除成功：同步清理本地缓存，避免列表残留
      await dbManager.deleteDomainFromCache(domainId);
      await dbManager.deleteCache(`api_cache:dns:${domainId}`);

      const msg = `域名 [${domainInfo.full_domain}] (账户: ${alias}) 已删除`;
      await dbManager.writeLog("warning", "operation", msg, res);

      // 删除会释放配额，回源刷新配额缓存
      try {
        const { accounts, quotas } = await fetchAllQuotas(dbManager);
        if (accounts.length > 0) {
          await dbManager.setCache("api_cache:quota", JSON.stringify(quotas));
        }
      } catch (e) {
        console.error("删除后刷新配额缓存失败:", e);
      }

      return c.json(successRes({ message: "域名删除成功", full_domain: domainInfo.full_domain }));
    }

    const reason = translateDeleteError(res?.message || "");
    await dbManager.writeLog(
      "error",
      "operation",
      `域名 [${domainInfo.full_domain}] 删除失败：${reason}`,
      res
    );
    return c.json(errorRes(reason, "delete_forbidden"), 409);
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(translateDeleteError(raw)), 400);
  }
});

// 4. 获取子域名下所有的 DNS 解析记录 (代理接口)
app.get("/api/domains/:id/dns", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);
  const cacheKey = `api_cache:dns:${domainId}`;
  const forceRefresh = c.req.query("refresh") === "1";

  try {
    // NOTE: 使用主键查询替代全表扫描
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未找到域名记录", "not_found"), 404);
    }

    // 读操作默认只命中缓存，不调用上游 API（除非显式强制刷新）
    if (!forceRefresh) {
      const cached = await dbManager.getCache(cacheKey);
      if (cached) {
        return c.json(successRes({ records: JSON.parse(cached) }));
      }
    }

    const { client } = await dbManager.getClientForAccount(domainInfo.account_id);
    const res = await client.listDnsRecords(domainId);
    
    if (res && res.success) {
      const records = res.records || [];
      await dbManager.setCache(cacheKey, JSON.stringify(records));
      await dbManager.writeLog("success", "api", `查看了域名 [${domainInfo.full_domain}] 的 DNS 解析记录 (${records.length} 条)`);
      return c.json(successRes({ records }));
    } else {
      throw new Error(res.message || "获取DNS记录失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 辅助函数：DNS 记录变更后，自动重新计算并同步更新域名的三态 (已委派 / 已解析 / 未解析)
async function syncDomainStatusAfterDnsChange(dbManager: DatabaseManager, client: DNSHEClient, domainId: number) {
  try {
    const dnsRes = await client.listDnsRecords(domainId);
    const records = (dnsRes && dnsRes.success && Array.isArray(dnsRes.records)) ? dnsRes.records : [];
    
    // 写操作回源后，将最新记录回填到缓存，后续读操作直接命中
    await dbManager.setCache(`api_cache:dns:${domainId}`, JSON.stringify(records));
    
    // 是否使用自定义/第三方 NS
    const nsRecords = records.filter(r => r.type === "NS");
    const hasCustomNs = nsRecords.length > 0;
    
    let computedStatus = "未解析";
    let hasDns = 1;
    
    if (hasCustomNs) {
      computedStatus = "已委派";
      hasDns = 0;
    } else if (records.length > 0) {
      computedStatus = "已解析";
      hasDns = 1;
    } else {
      computedStatus = "未解析";
      hasDns = 1;
    }

    await dbManager.updateDomainStatusAndDns(domainId, computedStatus, hasDns);
  } catch (e) {
    console.error(`域名状态实时更新异常 [subdomain_id: ${domainId}]:`, e);
  }
}

// 5. 新建 DNS 解析记录 (代理接口)
app.post("/api/domains/:id/dns", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);
  // NOTE: body 声明在 try 外层，以便 catch 块能访问已解析的请求体
  let body: Record<string, unknown> = {};

  try {
    body = await c.req.json();
    // NOTE: 使用主键查询替代全表扫描
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未找到域名记录", "not_found"), 404);
    }

    const { client } = await dbManager.getClientForAccount(domainInfo.account_id);
    const res = await client.createDnsRecord({
      subdomain_id: domainId,
      ...body
    } as CreateDnsRecordParams);

    if (res && res.success) {
      await dbManager.writeLog("success", "api", `在域名 [${domainInfo.full_domain}] 下创建了 [${body.type}] 记录: ${body.name || "@"} -> ${body.content}`);
      await syncDomainStatusAfterDnsChange(dbManager, client, domainId);
      return c.json(successRes({ message: "创建DNS记录成功", record: res.record }));
    } else {
      throw new Error(res.message || "创建DNS记录失败");
    }
  } catch (e: unknown) {
    const rawMsg = e instanceof Error ? e.message : "未知错误";
    // NOTE: DNSHE 上游 API 在 disable_ns_management 开关禁用时，
    // 会直接拒绝 NS 类型记录的写入并返回 403，此处翻译为更友好的中文提示
    const isNsType = body.type === "NS";
    const is403 = rawMsg.includes("403") || rawMsg.includes("Forbidden");
    const message = (isNsType && is403)
      ? "DNSHE 上游平台已禁用 NS 管理功能 (disable_ns_management)，无法通过 API 修改 NS 记录。请前往 DNSHE 官网后台手动设置。"
      : rawMsg;
    return c.json(errorRes(message, isNsType && is403 ? "ns_management_disabled" : "internal_error"), 400);
  }
});

// 6. 修改 DNS 解析记录 (代理接口)
app.put("/api/domains/:id/dns/:record_id", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);
  const recordId = c.req.param("record_id");

  try {
    const body = await c.req.json();
    // NOTE: 使用主键查询替代全表扫描
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未找到域名记录", "not_found"), 404);
    }

    const { client } = await dbManager.getClientForAccount(domainInfo.account_id);
    const res = await client.updateDnsRecord({
      record_id: recordId,
      subdomain_id: domainId,
      ...body
    });

    if (res && res.success) {
      await dbManager.writeLog("success", "api", `修改了域名 [${domainInfo.full_domain}] 下的记录 (ID: ${recordId}): ${body.type} -> ${body.content}`);
      await syncDomainStatusAfterDnsChange(dbManager, client, domainId);
      return c.json(successRes({ message: "更新DNS记录成功" }));
    } else {
      throw new Error(res.message || "更新DNS记录失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 7. 删除 DNS 解析记录 (代理接口)
app.delete("/api/domains/:id/dns/:record_id", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);
  const recordId = c.req.param("record_id");

  try {
    // NOTE: 使用主键查询替代全表扫描
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未找到域名记录", "not_found"), 404);
    }

    const { client } = await dbManager.getClientForAccount(domainInfo.account_id);
    const res = await client.deleteDnsRecord(domainId, recordId);

    if (res && res.success) {
      await dbManager.writeLog("success", "api", `删除了域名 [${domainInfo.full_domain}] 下的 DNS 记录 (ID: ${recordId})`);
      await syncDomainStatusAfterDnsChange(dbManager, client, domainId);
      return c.json(successRes({ message: "删除DNS记录成功" }));
    } else {
      throw new Error(res.message || "删除DNS记录失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 额度配额接口 — 使用 Promise.allSettled 并发查询所有账号配额
 * 
 * NOTE: 原先使用 for...of 串行查询，5 个账号总延迟为 5x 单次请求延迟。
 * 改为并发后总延迟降至单次请求耗时。
 */
/**
 * 辅助函数：并发拉取所有账号的配额并返回（不含缓存逻辑，供接口与写操作回填复用）
 */
async function fetchAllQuotas(dbManager: DatabaseManager): Promise<{ accounts: Array<{ id: number; alias: string }>; quotas: any[] }> {
  const accounts = await dbManager.getAccounts();

  // 并发发起所有账号的配额查询请求
  const quotaPromises = accounts.map(async (acc) => {
    const { client } = await dbManager.getClientForAccount(acc.id);
    const qRes = await client.getQuota();
    if (qRes && qRes.success) {
      return {
        account_id: acc.id,
        alias: acc.alias,
        ...qRes.quota
      };
    }
    throw new Error(qRes.message || "获取额度失败");
  });

  const results = await Promise.allSettled(quotaPromises);

  const quotas = results.map((result, idx) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      account_id: accounts[idx].id,
      alias: accounts[idx].alias,
      error: result.reason?.message || "获取额度失败"
    };
  });

  return { accounts, quotas };
}

app.get("/api/quota", async (c) => {
  const dbManager = c.get("db");
  const cacheKey = "api_cache:quota";
  const forceRefresh = c.req.query("refresh") === "1";

  try {
    // 读操作默认只命中缓存，不调用上游 API（除非显式强制刷新）
    if (!forceRefresh) {
      const cached = await dbManager.getCache(cacheKey);
      if (cached) {
        return c.json(successRes({ quotas: JSON.parse(cached) }));
      }
    }

    const { accounts, quotas } = await fetchAllQuotas(dbManager);

    if (accounts.length > 0) {
      await dbManager.writeLog("success", "api", `查询了 ${accounts.length} 个账号的账户配额`);
      await dbManager.setCache(cacheKey, JSON.stringify(quotas));
    }

    return c.json(successRes({ quotas }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

/**
 * 系统运行日志 API
 */

// 1. 获取日志列表
app.get("/api/logs", async (c) => {
  const dbManager = c.get("db");
  try {
    const logs = await dbManager.getLogs(100);
    return c.json(successRes({ logs }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

// 2. 清空运行日志
app.post("/api/logs/clear", async (c) => {
  const dbManager = c.get("db");
  try {
    await dbManager.clearLogs();
    return c.json(successRes({ message: "日志已清空" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

/**
 * 应用设置 API
 */

// 敏感字段打码：仅保留后 4 位
function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 4) return "****";
  return "****" + v.slice(-4);
}

// 1. 读取所有应用配置（敏感值打码）
app.get("/api/settings", async (c) => {
  const dbManager = c.get("db");
  try {
    const cfg = await dbManager.getAllAppSettings();
    // 敏感字段打码后再返回
    const masked = { ...cfg };
    if (masked.tg_token) masked.tg_token = maskSecret(cfg.tg_token);
    if (masked.webhook_url) masked.webhook_url = maskSecret(cfg.webhook_url);
    // 标记哪些敏感字段已配置（前端用于占位提示）
    const configured = {
      tg_token: !!cfg.tg_token,
      webhook_url: !!cfg.webhook_url,
    };
    return c.json(successRes({ settings: masked, configured }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 500);
  }
});

// 2. 保存应用配置（空值/打码值表示不修改）
app.post("/api/settings", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    // 允许写入的配置键
    const allowedKeys = [
      "webhook_url", "webhook_type", "tg_token", "tg_chat_id",
      "renew_threshold_days", "auto_renew"
    ];
    // 敏感字段：若值为空或仍是打码值（以 **** 开头），则跳过不覆盖
    const sensitiveKeys = ["tg_token", "webhook_url"];

    for (const key of allowedKeys) {
      if (!(key in body)) continue;
      const val = String(body[key] ?? "");
      if (sensitiveKeys.includes(key)) {
        if (val === "" || val.startsWith("****")) continue; // 不覆盖已有敏感值
      }
      await dbManager.setAppSetting(key, val);
    }

    await dbManager.writeLog("success", "operation", "管理员更新了系统设置配置");
    return c.json(successRes({ message: "设置已保存" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 3. 测试 Telegram 推送
app.post("/api/settings/test-telegram", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json().catch(() => ({}));
    const cfg = await dbManager.getAllAppSettings();
    // 优先用请求体里传入的新值（用户可能还没保存），否则用库里已存的
    const token = (body.tg_token && !String(body.tg_token).startsWith("****")) ? String(body.tg_token) : cfg.tg_token;
    const chatId = String(body.tg_chat_id || cfg.tg_chat_id || "");

    if (!token || !chatId) {
      return c.json(errorRes("请先填写 Telegram Bot Token 与 Chat ID", "bad_request"), 400);
    }

    await sendTelegramNotification(token, chatId, "🎉 DNSHE Manager 测试推送：Telegram 通知配置成功！");
    return c.json(successRes({ message: "测试消息已发送，请检查 Telegram" }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 8. WHOIS 查询域名可注册性 (代理接口)
 */
app.get("/api/whois", async (c) => {
  const domain = c.req.query("domain");
  const accountIdParam = c.req.query("account_id");
  if (!domain) {
    return c.json(errorRes("必须提供完整的域名参数 (例如 test.us.ci)", "bad_request"), 400);
  }

  const dbManager = c.get("db");
  try {
    let client: DNSHEClient;
    if (accountIdParam) {
      const auth = await dbManager.getClientForAccount(Number(accountIdParam));
      client = auth.client;
    } else {
      const accounts = await dbManager.getAccounts();
      if (accounts.length > 0) {
        const auth = await dbManager.getClientForAccount(accounts[0].id);
        client = auth.client;
      } else {
        client = new DNSHEClient("public", "public");
      }
    }

    const asciiDomain = toASCII(domain.trim());
    const res = await client.whois(asciiDomain);

    // 查重池回填：确认已注册的域名写入池子（7 天 TTL），供后续批量扫描直接跳过
    if (res && res.registered === true) {
      await dbManager.addToWhoisPool(asciiDomain);
    }

    // 批量扫描（batch=1）单轮可达数万次查询，逐条写日志会让 logs 表爆炸式增长
    // 并拖慢整库，这里按 1/50 采样；单次手动查询仍然全量记录。
    const isBatch = c.req.query("batch") === "1";
    if (!isBatch) {
      await dbManager.writeLog("success", "api", `WHOIS 查询域名 [${asciiDomain}]`);
    } else if (Math.random() < 0.02) {
      await dbManager.writeLog("info", "api", `批量查重采样：WHOIS 查询域名 [${asciiDomain}]（每 50 次采样记录 1 条）`);
    }
    return c.json(successRes({ whois: res }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "WHOIS 查询异常";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 8.5 批量查询查重池 —— 返回其中已确认「已注册」且未过期的域名
 *
 * 供前端批量扫描在发起 WHOIS 前先行过滤，避免重复消耗上游 API 配额。
 *
 * 提供 POST（推荐，域名走请求体，不受 URL 长度限制）与 GET（兼容旧前端）两种入口。
 * 入参域名非 ASCII 会统一转 Punycode 后匹配。
 */
async function queryWhoisPool(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  rawDomains: string[]
) {
  const dbManager = c.get("db");
  try {
    const domains = rawDomains
      .map(d => toASCII(String(d || "").trim()))
      .filter(Boolean);

    if (domains.length === 0) {
      return c.json(successRes({ registered: [] }));
    }
    // 单次查询上限（服务端内部会再按语句长度自动分批）
    if (domains.length > 500) {
      return c.json(errorRes("单次最多查询 500 个域名", "bad_request"), 400);
    }

    const registered = await dbManager.getWhoisPool(domains);
    return c.json(successRes({ registered }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "查重池查询异常";
    return c.json(errorRes(message), 400);
  }
}

app.post("/api/whois/pool", async (c) => {
  let body: { domains?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorRes("请求体必须为 JSON", "bad_request"), 400);
  }
  if (!Array.isArray(body.domains)) {
    return c.json(errorRes("必须提供 domains 数组", "bad_request"), 400);
  }
  return queryWhoisPool(c, body.domains as string[]);
});

app.get("/api/whois/pool", async (c) => {
  const domainsParam = c.req.query("domains");
  if (!domainsParam) {
    return c.json(errorRes("必须提供 domains 参数（逗号分隔）", "bad_request"), 400);
  }
  return queryWhoisPool(c, domainsParam.split(","));
});

/**
 * 9. 在线注册新子域名 (代理接口)
 */
app.post("/api/domains/register", async (c) => {
  const dbManager = c.get("db");

  try {
    const { account_id, subdomain, rootdomain } = await c.req.json();
    if (!account_id || !subdomain || !rootdomain) {
      return c.json(errorRes("必须提供 account_id, subdomain 及 rootdomain", "bad_request"), 400);
    }

    const { client } = await dbManager.getClientForAccount(account_id);
    // 中文等非 ASCII 域名统一转 Punycode (xn--) 后再送往上游 DNSHE API
    const asciiSub = toASCII(String(subdomain).trim());
    const asciiRoot = toASCII(String(rootdomain).trim());
    const res = await client.registerSubdomain(asciiSub, asciiRoot);

    if (res && res.success) {
      const fullDomain = res.full_domain || `${asciiSub}.${asciiRoot}`;
      await dbManager.writeLog("success", "api", `成功在账号 [ID: ${account_id}] 下注册了免费域名: [${fullDomain}]`);
      // 注册会消耗配额，回源刷新配额缓存，保证后续读操作命中最新数据
      try {
        const { accounts, quotas } = await fetchAllQuotas(dbManager);
        if (accounts.length > 0) {
          await dbManager.setCache("api_cache:quota", JSON.stringify(quotas));
        }
      } catch (e) {
        console.error("注册后刷新配额缓存失败:", e);
      }
      
      // 触发一次账号全量同步，把新注册域名自动拉入 domains_cache 数据库
      try {
        const subdomains = await fetchAllSubdomainsFromClient(client);
        await dbManager.syncAccountDomains(account_id, subdomains);
      } catch (e) {
        console.error("注册后同步错误:", e);
      }

      return c.json(successRes({ message: `域名 [${fullDomain}] 注册成功！`, subdomain_id: res.subdomain_id, full_domain: fullDomain }));
    } else {
      throw new Error(res.message || "注册子域名失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "注册子域名发生错误";
    return c.json(errorRes(message), 400);
  }
});

/**
 * 导出 Worker 入口
 */
export default {
  fetch: app.fetch,
  
  // 处理 scheduled 定时任务 (Cron Trigger)
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const dbManager = new DatabaseManager(env.DB, env.AES_KEY);
    const webhookType = (env.WEBHOOK_TYPE || "custom") as "dingtalk" | "feishu" | "wecom" | "custom";
    // 使用 ctx.waitUntil 保证 Worker 不会在异步任务未结束时被回收
    ctx.waitUntil(runDailySyncAndRenewal(dbManager, env.WEBHOOK_URL, webhookType));
  }
};
