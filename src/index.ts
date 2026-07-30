import { Hono } from "hono";
import { cors } from "hono/cors";
import { DatabaseManager } from "./db";
import { runDailySyncAndRenewal } from "./cron";

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
        // 同步一次域名
        try {
          const { client } = await dbManager.getClientForAccount(newAcc.id);
          const res = await client.listSubdomains(1, 500);
          if (res && res.success && Array.isArray(res.subdomains)) {
            await dbManager.syncAccountDomains(newAcc.id, res.subdomains);
          }
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
    const allowedOrigin = c.env.ALLOWED_ORIGIN || "*";
    const corsMiddleware = cors({
      origin: allowedOrigin,
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
 * 校验 6 位 TOTP (2FA 动态口令) 是否有效
 * 自动识别 Base32 编码密钥，支持 ±60 秒 (±2 时间步长) 的系统时钟倾斜容差
 */
async function verifyTOTP(token: string, secretStr: string): Promise<boolean> {
  const cleanToken = token.trim();
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const cleanSecret = secretStr.trim();
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
 * 鉴权中间件 — 所有 /api/* 请求必须携带有效的 Bearer Token (支持 2FA 6位动态口令或静态 Secret)
 * 
 * NOTE: 当未配置 ADMIN_TOKEN 环境变量时，跳过鉴权（便于本地开发调试）。
 * 部署生产环境时，务必通过 `wrangler secret put ADMIN_TOKEN` 注入密钥。
 */
app.use("/api/*", async (c, next) => {
  const adminToken = c.env.ADMIN_TOKEN;

  // 未配置 ADMIN_TOKEN 时跳过鉴权，便于开发环境调试
  if (!adminToken) {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(errorRes("未提供有效的 Authorization 头部，格式应为: Bearer <token>", "unauthorized"), 401);
  }

  const token = authHeader.substring(7).trim();

  // 1. 支持 2FA TOTP 6位动态验证码
  const isTotpValid = await verifyTOTP(token, adminToken);
  if (isTotpValid) {
    return next();
  }

  // 2. 支持传统静态 Token
  if (token === adminToken) {
    return next();
  }

  return c.json(errorRes("认证失败：动态 2FA 验证码或管理口令无效", "forbidden"), 403);
});

/**
 * DatabaseManager 实例化中间件 — 避免在每个路由中重复创建
 * 
 * NOTE: 通过 Hono 的 Variables 机制，将 dbManager 注入到上下文中，
 * 后续路由通过 c.get("db") 获取，消除了 16 处重复的 new DatabaseManager(...) 代码。
 */
app.use("/api/*", async (c, next) => {
  const dbManager = new DatabaseManager(c.env.DB, c.env.AES_KEY);
  await dbManager.ensureTables();
  c.set("db", dbManager);
  return next();
});

/**
 * 统一响应辅助函数
 */
const successRes = (data: Record<string, unknown> = {}) => {
  return { success: true, ...data };
};

// NOTE: 移除了原先未被使用的 status 参数，避免开发者误认为它会影响 HTTP 状态码
const errorRes = (message: string, code = "internal_error") => {
  return { success: false, error_code: code, message };
};

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

// 2. 绑定新账号
app.post("/api/accounts", async (c) => {
  const dbManager = c.get("db");
  try {
    const body = await c.req.json();
    const { alias, api_key, api_secret } = body;
    
    if (!alias || !api_key || !api_secret) {
      return c.json(errorRes("参数缺失：alias, api_key, api_secret 均为必填项", "bad_request"), 400);
    }

    const newAccount = await dbManager.addAccount(alias, api_key, api_secret);
    
    // 绑定成功后，在后台触发一次该账号的域名同步，防止页面上显示为空
    try {
      const { client } = await dbManager.getClientForAccount(newAccount.id);
      const res = await client.listSubdomains(1, 500);
      if (res && res.success && Array.isArray(res.subdomains)) {
        await dbManager.syncAccountDomains(newAccount.id, res.subdomains);
      }
    } catch (syncErr: unknown) {
      console.error("Initial domain sync failed for new account:", syncErr);
    }

    return c.json(successRes({ account: newAccount }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 3. 解绑账号
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
      await dbManager.writeLog("success", "renew", msg, res);
      
      return c.json(successRes({ message: "续期成功", new_expires_at: newExpiresAt }));
    } else {
      throw new Error(res.message || "续期请求失败");
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "未知错误";
    return c.json(errorRes(message), 400);
  }
});

// 4. 获取子域名下所有的 DNS 解析记录 (代理接口)
app.get("/api/domains/:id/dns", async (c) => {
  const dbManager = c.get("db");
  const domainId = parseInt(c.req.param("id"), 10);

  try {
    // NOTE: 使用主键查询替代全表扫描
    const domainInfo = await dbManager.getDomainById(domainId);
    if (!domainInfo) {
      return c.json(errorRes("未找到域名记录", "not_found"), 404);
    }

    const { client } = await dbManager.getClientForAccount(domainInfo.account_id);
    const res = await client.listDnsRecords(domainId);
    
    if (res && res.success) {
      return c.json(successRes({ records: res.records || [] }));
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
    });

    if (res && res.success) {
      await dbManager.writeLog("success", "system", `在域名 [${domainInfo.full_domain}] 下创建了 [${body.type}] 记录: ${body.name || "@"} -> ${body.content}`);
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
      await dbManager.writeLog("success", "system", `修改了域名 [${domainInfo.full_domain}] 下的记录 (ID: ${recordId}): ${body.type} -> ${body.content}`);
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
      await dbManager.writeLog("success", "system", `删除了域名 [${domainInfo.full_domain}] 下的 DNS 记录 (ID: ${recordId})`);
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
app.get("/api/quota", async (c) => {
  const dbManager = c.get("db");
  try {
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

    const res = await client.whois(domain.trim());
    return c.json(successRes({ whois: res }));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "WHOIS 查询异常";
    return c.json(errorRes(message), 400);
  }
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
    const res = await client.registerSubdomain(subdomain.trim(), rootdomain.trim());

    if (res && res.success) {
      const fullDomain = res.full_domain || `${subdomain.trim()}.${rootdomain.trim()}`;
      await dbManager.writeLog("success", "sync", `成功在账号 [ID: ${account_id}] 下注册了免费域名: [${fullDomain}]`);
      
      // 触发一次账号全量同步，把新注册域名自动拉入 domains_cache 数据库
      try {
        const subdomains = await fetchAllSubdomainsFromClient(client);
        await dbManager.saveSubdomainsCache(account_id, subdomains);
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
