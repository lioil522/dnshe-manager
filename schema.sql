-- 1. API 账号表
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL,                  -- 账号别名
    api_key TEXT NOT NULL UNIQUE,         -- API Key
    api_secret TEXT NOT NULL,             -- 加密后的 API Secret
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 域名缓存表
CREATE TABLE IF NOT EXISTS domains_cache (
    id INTEGER PRIMARY KEY,               -- subdomain_id (DNSHE 的子域名ID)
    account_id INTEGER NOT NULL,          -- 绑定的账号 ID
    subdomain TEXT NOT NULL,              -- 子域名前缀
    rootdomain TEXT NOT NULL,             -- 根域名
    full_domain TEXT NOT NULL,            -- 完整域名
    status TEXT NOT NULL,                 -- 状态 (active/suspended/expired)
    created_at TEXT,                      -- 注册时间 (YYYY-MM-DD HH:MM:SS)
    expires_at TEXT NOT NULL,             -- 到期时间 (YYYY-MM-DD HH:MM:SS)
    last_renewed_at TEXT,                 -- 上次自动续期时间
    has_dns INTEGER DEFAULT 1,            -- 是否使用默认 NS 并启用 DNS 管理 (1=是, 0=否)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- 3. 系统运行日志表（包含同步与自动续期日志）
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                   -- info / success / warning / error
    category TEXT NOT NULL,               -- sync / renew / system / auth / api / operation
    message TEXT NOT NULL,                -- 简短描述
    details TEXT,                         -- 详细 JSON 内容或报错堆栈
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. API 上游响应缓存表（防止频繁调用 DNSHE 官方 API 被判定滥用）
CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,                 -- 缓存键 (如 api_cache:quota / api_cache:dns:<domainId>)
    value TEXT NOT NULL,                  -- 缓存的 JSON 数据
    expires_at INTEGER NOT NULL           -- 绝对过期时间 (epoch 秒)
);

-- 创建索引以加速跨账号域名搜索和定时扫描
CREATE INDEX IF NOT EXISTS idx_domains_account ON domains_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_domains_expires ON domains_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
