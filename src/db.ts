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
   */
  async ensureTables() {
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
        `)
      ]);
    } catch (e) {
      console.error("Auto ensureTables error:", e);
    }
  }

  /**
   * 写入日志
   */
  async writeLog(type: "info" | "success" | "warning" | "error", category: "sync" | "renew" | "system", message: string, details?: unknown) {
    try {
      const detailsStr = details ? (typeof details === "string" ? details : JSON.stringify(details)) : null;
      await this.db.prepare(
        "INSERT INTO logs (type, category, message, details) VALUES (?, ?, ?, ?)"
      ).bind(type, category, message, detailsStr).run();
    } catch (e) {
      console.error("Failed to write database log:", e);
    }
  }

  /**
   * 获取日志列表 (按时间倒序，限制100条)
   */
  async getLogs(limit = 100): Promise<DBLog[]> {
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
    await this.writeLog("info", "system", "已手动清空运行日志");
  }

  /**
   * 实时更新域名的解析状态与 NS 标记 (用于 DNS 增删改后精准即时刷新状态)
   */
  async updateDomainStatusAndDns(domainId: number, status: string, hasDns: number) {
    try {
      await this.db.prepare(
        "UPDATE domains_cache SET status = ?, has_dns = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(status, hasDns, domainId).run();
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
   * 添加 API 账户
   */
  async addAccount(alias: string, apiKey: string, apiSecret: string): Promise<DBAccount> {
    // 验证秘钥是否可用
    const client = new DNSHEClient(apiKey, apiSecret);
    try {
      await client.getQuota();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "未知错误";
      throw new Error(`无法验证 API 密钥有效性: ${message}`);
    }

    const encryptedSecret = await encryptText(apiSecret, this.aesKey);
    
    // 如果没有配置 AES_KEY 并且使用 plain 存储，记录一条 Warning 日志
    if (!this.aesKey) {
      await this.writeLog("warning", "system", `账户 [${alias}] 已绑定，但由于未配置 AES_KEY，秘钥将以不安全的方式（弱 Base64 编码）存储在 D1 中！`);
    } else {
      await this.writeLog("success", "system", `账户 [${alias}] 绑定成功，已启用 AES-GCM 安全加密`);
    }

    await this.db.prepare(
      "INSERT INTO accounts (alias, api_key, api_secret) VALUES (?, ?, ?)"
    ).bind(alias, apiKey, encryptedSecret).run();

    const result = await this.db.prepare(
      "SELECT id, alias, api_key, created_at FROM accounts WHERE api_key = ?"
    ).bind(apiKey).first<DBAccount>();

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
   * 删除账户
   */
  async deleteAccount(id: number) {
    const account = await this.db.prepare("SELECT alias FROM accounts WHERE id = ?").bind(id).first();
    const alias = account ? (account as { alias: string }).alias : `ID ${id}`;
    
    await this.db.prepare("DELETE FROM accounts WHERE id = ?").bind(id).run();
    await this.writeLog("info", "system", `解绑了账户 [${alias}]，其名下的域名缓存已被自动级联清理`);
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
   * 同步单个账号名下的域名到缓存表
   */
  async syncAccountDomains(accountId: number, subdomains: Array<{
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
  }>) {
    const statements: D1PreparedStatement[] = [];
    
    // 1. 获取当前缓存中该账号所有的域名 ID 集合，以便删除在 DNSHE 后台已经被删掉的域名
    const cachedDomains = await this.db.prepare(
      "SELECT id FROM domains_cache WHERE account_id = ?"
    ).bind(accountId).all();
    const cachedIds = new Set((cachedDomains.results || []).map((d: Record<string, unknown>) => d.id as number));
    const activeIds = new Set(subdomains.map(s => s.id));

    // 2. 准备插入/更新操作
    for (const sub of subdomains) {
      // 判断 NS 是否为默认 ns1.dnshe.com / ns2.dnshe.com，或 disable_ns_management 状态
      let hasDnsVal = 1;
      if (sub.disable_ns_management) {
        hasDnsVal = 0;
      } else if (sub.ns1 || sub.ns2) {
        const ns1 = (sub.ns1 || "").toLowerCase();
        const ns2 = (sub.ns2 || "").toLowerCase();
        const isDefault = ns1.includes("dnshe.com") || ns2.includes("dnshe.com");
        hasDnsVal = isDefault ? 1 : 0;
      } else if (sub.has_dns !== undefined) {
        hasDnsVal = sub.has_dns ? 1 : 0;
      }

      statements.push(
        this.db.prepare(`
          INSERT INTO domains_cache (id, account_id, subdomain, rootdomain, full_domain, status, created_at, expires_at, has_dns)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            created_at = COALESCE(NULLIF(excluded.created_at, ''), domains_cache.created_at),
            expires_at = excluded.expires_at,
            has_dns = excluded.has_dns,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          sub.id,
          accountId,
          sub.subdomain,
          sub.rootdomain,
          sub.full_domain,
          sub.status,
          sub.created_at || "",
          sub.expires_at || "",
          hasDnsVal
        )
      );
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
    await this.db.prepare(`
      UPDATE domains_cache 
      SET expires_at = ?, last_renewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(newExpiresAt, id).run();
  }
}
