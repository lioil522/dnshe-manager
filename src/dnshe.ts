/**
 * DNSHE API 响应类型定义 + 请求封装
 *
 * 本文件承担三件事：
 *  1. 各端点的响应类型（编译期字段提示）
 *  2. 全局速率护栏（时间片队列，跨实例共享）
 *  3. 429 / 520 分流与冷却短路
 *
 * ── 实测契约（2026-10-29，串行 120 次请求取证）──
 *  · 限流：**30 次/分钟**滑动窗口，超出返回 429，下一分钟自动恢复。
 *    响应体带 limit/remaining/reset_at，但**没有 Retry-After 头**，
 *    也没有 X-RateLimit-* 头 —— 退避只能靠 body 里的 reset_at 计算。
 *  · reset_at 是**北京时间（UTC+8）**的 "YYYY-MM-DD HH:mm:ss"，
 *    比响应头 date（GMT）快 8 小时，解析时必须显式带 +08:00。
 *  · 520 与限流无关：串行 120 次 0 次 520，只有瞬时打崩或来源 IP 被拦才会 520。
 *    因此 520 绝不能靠退避重试恢复，只能短路。
 */

/** 通用基础响应 */
export interface BaseResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/** 配额查询响应 */
export interface QuotaResponse extends BaseResponse {
  quota?: {
    used: number;
    base: number;
    invite_bonus: number;
    total: number;
    available: number;
  };
}

/**
 * 分页信息
 *
 * NOTE: 实测 `subdomains/list` 的顶层**没有** `total` 字段，总数在
 * `pagination.total` 里；是否还有下一页看 `pagination.has_more`。
 * 早期代码读 `res.total` 的分支永远不生效，靠 `length < per_page` 侥幸正确 ——
 * 一旦某账号域名数恰为 per_page 的整数倍，会多打一次空页请求。
 */
export interface DnshePagination {
  mode?: string;
  page?: number;
  per_page?: number;
  has_more?: boolean;
  next_page?: number | null;
  prev_page?: number | null;
  total?: number;
}

/** 子域名列表响应 */
export interface ListSubdomainsResponse extends BaseResponse {
  subdomains?: SubdomainInfo[];
  count?: number;
  pagination?: DnshePagination;
  /** @deprecated 顶层无此字段，请用 pagination.total */
  total?: number;
  /** @deprecated 顶层无此字段，请用 pagination.page */
  page?: number;
  /** @deprecated 顶层无此字段，请用 pagination.per_page */
  per_page?: number;
}

/** 子域名信息 */
export interface SubdomainInfo {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  expires_at?: string;
  created_at?: string;
  disable_ns_management?: boolean | number;
  has_dns?: boolean | number;
  ns1?: string;
  ns2?: string;
  /**
   * 该域名所在的解析服务商账号 ID —— `subdomains/list` 不传 fields 时默认就返回，
   * 无需额外调用。
   *
   * NOTE: 「域名是否支持按线路（运营商/地域）解析」在 API 里无从查起 —— 文档没有
   * 任何线路能力字段（`fields` 参数枚举了子域名的全部可选字段，里面没有），也没有
   * 根域名列表或 capability 接口；官网自己也是把「目前只有 us.ci 与 cn.mt 支持」
   * 写死在文案里的。实测同一账号下 us.ci / cn.mt 的该值为 1，其余 7 个根域名为
   * 7 或 8，两组取值无交集。
   *
   * 但文档从未说明这个字段的语义，属实测相关性而非契约。现已改用根域名的 NS 记录
   * 作为主判定信号（见 `/api/dns/ns` 与前端 DNSHE_LINE_NS_SUFFIXES）—— NS 落在
   * vip*.alidns.com 的根域支持线路，落在 DNSHE 自建 NS 的不支持，语义比裸数字明确
   * 得多。本字段降级为 NS 查不到时的兜底信号，前端不再提供对应的可编辑名单。
   */
  provider_account_id?: number | string | null;
}

/** 子域名详情响应 */
export interface GetSubdomainResponse extends BaseResponse {
  subdomain?: SubdomainInfo;
  /** 实测字段名为 dns_records（文档 1.3 节），不是 records */
  dns_records?: DnsRecordInfo[];
  dns_count?: number;
  /** @deprecated 实测该字段不存在，请用 dns_records */
  records?: DnsRecordInfo[];
}

/** 续期响应 */
export interface RenewResponse extends BaseResponse {
  new_expires_at?: string;
  charged_amount?: number;
  remaining_days?: number;
}

/** DNS 记录列表响应 */
export interface ListDnsRecordsResponse extends BaseResponse {
  records?: DnsRecordInfo[];
  count?: number;
}

/** DNS 记录信息 */
export interface DnsRecordInfo {
  // Cloudflare 的记录 id 是 32 位十六进制字符串，DNSHE 是数字，统一放宽为联合类型
  id: number | string;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  line?: string | null;
  proxied?: boolean;
  /**
   * Cloudflare 专用：当该 AAAA 100:: proxied 记录是 Worker 路由占位时，
   * 填上绑定的 Worker 名（来自 /zones/:id/workers/routes 的 script_name）。
   * 前端据此把「AAAA 100::」渲染为「Worker」类型，DNSHE/DigitalPlat 记录无此字段。
   */
  workerName?: string;
}

/**
 * 创建 DNS 记录响应
 *
 * NOTE: 实测返回 `{success, message, id, record_id}`，**没有** `record` 对象。
 * 需要完整记录时得再调一次 `dns_records/list`。保留 record 字段仅为向后兼容。
 */
export interface CreateDnsRecordResponse extends BaseResponse {
  id?: number | string;
  record_id?: string;
  /** @deprecated 实测该字段不存在 */
  record?: DnsRecordInfo;
}

/** API 密钥信息 */
export interface ApiKeyInfo {
  id: number;
  key_name?: string;
  api_key: string;
  status: string;
  request_count?: number;
  last_used_at?: string;
  created_at?: string;
}

/** 列出 API 密钥响应 */
export interface ListApiKeysResponse extends BaseResponse {
  keys?: ApiKeyInfo[];
  count?: number;
}

/** 通用操作响应（用于更新、删除等不返回额外数据的操作） */
export interface ActionResponse extends BaseResponse {}

/** 注册子域名响应 */
export interface RegisterSubdomainResponse extends BaseResponse {
  subdomain_id?: number;
  full_domain?: string;
}

/** 创建 DNS 记录参数 */
export interface CreateDnsRecordParams {
  subdomain_id: number;
  type: string;
  name?: string;
  content: string;
  ttl?: number;
  priority?: number;
  line?: string;
  weight?: number;
  port?: number;
  target?: string;
}

/** 更新 DNS 记录参数 */
export interface UpdateDnsRecordParams extends CreateDnsRecordParams {
  record_id: string | number;
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 上游不可达（520/521/522/523/524）或处于冷却期
 *
 * NOTE: 与限流**无关**。实测串行 120 次 0 次 520，只有瞬时打崩或来源 IP
 * 被拦才会出现。退避重试对它无效，唯一正确处理是立即中止当前批次。
 */
export class DnsheOriginError extends Error {
  public readonly httpStatus: number;
  public readonly originBody?: string;

  constructor(message = "DNSHE 上游不可达（520），请稍后重试", httpStatus = 520, originBody?: string) {
    super(message);
    this.name = "DnsheOriginError";
    this.httpStatus = httpStatus;
    this.originBody = originBody;
    Object.setPrototypeOf(this, DnsheOriginError.prototype);
  }
}

/**
 * 触发限流（429）且退避后仍失败
 *
 * NOTE: 携带 resetAt（毫秒时间戳），调用方可用于展示「X 秒后重试」。
 */
export class DnsheRateLimitError extends Error {
  public readonly limit: number;
  public readonly resetAt: number | null;

  constructor(message = "DNSHE API 请求频率超限（30 次/分钟），请稍后重试", resetAt: number | null = null, limit = 30) {
    super(message);
    this.name = "DnsheRateLimitError";
    this.resetAt = resetAt;
    this.limit = limit;
    Object.setPrototypeOf(this, DnsheRateLimitError.prototype);
  }
}

/** 凭证无效（401），提示用户换 Key */
export class DnsheAuthError extends Error {
  constructor(message = "DNSHE API 凭证无效，请检查 API Key / Secret") {
    super(message);
    this.name = "DnsheAuthError";
    Object.setPrototypeOf(this, DnsheAuthError.prototype);
  }
}

/** 判断是否属于「上游不可达」，调用方据此中止整批 */
export function isDnsheOriginError(e: unknown): e is DnsheOriginError {
  return e instanceof DnsheOriginError || (e instanceof Error && e.name === "DnsheOriginError");
}

// ============================================================================
// 全局速率护栏 —— 时间片队列
// ============================================================================

/**
 * 相邻两次上游请求的最小间隔
 *
 * 实测窗口上限 30 次/分钟。取 2200ms ≈ 27.3 次/分钟，留约 10% 余量，
 * 避免卡在边界上被 429。
 */
export const DNSHE_MIN_INTERVAL_MS = 2200;

/**
 * 每个 API Key 的下一个可用时间片
 *
 * ⚠️ **限流是按 API Key 独立计算的，不是按出口 IP。** 这一点经实测取证：
 *   · KeyA 连打到第 45 次触发 429（remaining=0/30）
 *   · 同一秒、同一出口 IP 下用 KeyB 请求 → **200 成功**
 *   · 用无效 Key 请求 → **401**（而非 429）
 * 第三条说明鉴权发生在限流之前，限流器只对「已认证的 Key」计数。
 * 若按 IP 限流，无效 Key 会先被 429 拦下而不是走到鉴权。
 *
 * WHY 必须按 Key 分桶而不是全局单例：每个账号一套独立 Key，各享 30 次/分钟。
 * 若所有实例共享一个时间片队列，N 个账号的总吞吐会被压到单账号水平
 * （实测 6 账号会把同步总时长放大 6 倍），等于自我限流。
 *
 * WHY 仍用预约制：同一 Key 内的并发调用各自领走一个未来时间片，
 * 天然串行化。即使上层忘了批处理，这一层也能兜住单 Key 的速率。
 */
const nextSlotByKey = new Map<string, number>();

/** 防止 Map 无限增长：条目数超过此阈值时清理已过期的时间片 */
const SLOT_MAP_PRUNE_THRESHOLD = 64;

/** 仅供测试重置限速队列状态 */
export function resetDnsheRateLimiterForTest(): void {
  nextSlotByKey.clear();
  memoryCooldownByKey.clear();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 领取该 API Key 的一个时间片，必要时等待 */
async function acquireSlot(apiKey: string): Promise<void> {
  const now = Date.now();
  const next = nextSlotByKey.get(apiKey) ?? 0;
  const wait = Math.max(0, next - now);
  nextSlotByKey.set(apiKey, Math.max(now, next) + DNSHE_MIN_INTERVAL_MS);

  // 顺手清理：条目过多时丢掉已经过期的时间片，避免 Map 长期膨胀
  // （一个 isolate 里 Key 数量有限，这里只是兜底）
  if (nextSlotByKey.size > SLOT_MAP_PRUNE_THRESHOLD) {
    for (const [k, v] of nextSlotByKey) {
      if (v <= now) nextSlotByKey.delete(k);
    }
  }

  if (wait > 0) await sleep(wait);
}

// ============================================================================
// 冷却短路 —— 520 后不再骚扰上游
// ============================================================================

export const DNSHE_COOLDOWN_KEY_PREFIX = "dnshe:origin:cooldown";
/** 冷却时长：600s。每次命中会刷新，源站持续故障则冷却自动延长 */
export const DNSHE_COOLDOWN_TTL_SECONDS = 600;

/**
 * 冷却键按 API Key 分桶
 *
 * WHY：520 是「按 (来源 IP, Host) 组合」拦截的，同一出口 IP 下所有 Key 通常一起被拦；
 * 但限流与账号状态是按 Key 的。按 Key 分桶能让「某个 Key 自己的问题」不波及其它账号，
 * 同时同一 IP 被整体拦截时各个 Key 仍会各自命中（行为一致，只是多查几次）。
 *
 * NOTE: 键里用 Key 的哈希前缀而非明文 —— cache 表的键会出现在备份/日志里，
 * 不该留下可用的凭证片段。
 */
function cooldownKeyFor(apiKey: string): string {
  // 轻量稳定哈希（FNV-1a 32bit），仅用于分桶，不需要抗碰撞
  let h = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    h ^= apiKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${DNSHE_COOLDOWN_KEY_PREFIX}:${(h >>> 0).toString(16)}`;
}

/**
 * 冷却存储适配器
 *
 * WHY 需要注入：DNSHEClient 不持有 D1 引用（保持可被旧版/测试直接复用）。
 * 生产环境由 DatabaseManager 注入 D1 实现，使多个 isolate 共享同一份冷却状态；
 * 未注入时降级为进程内变量，仅单 isolate 有效。
 */
export interface DnsheCooldownStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

let cooldownStore: DnsheCooldownStore | null = null;
/** 未注入 store 时的降级状态（按 key 分桶） */
const memoryCooldownByKey = new Map<string, number>();

export function setDnsheCooldownStore(store: DnsheCooldownStore | null): void {
  cooldownStore = store;
}

async function readCooldownUntil(apiKey: string): Promise<number> {
  const key = cooldownKeyFor(apiKey);
  if (!cooldownStore) return memoryCooldownByKey.get(key) ?? 0;
  try {
    const raw = await cooldownStore.get(key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { until?: number };
    return typeof parsed?.until === "number" ? parsed.until : 0;
  } catch {
    return 0;
  }
}

async function writeCooldown(apiKey: string, status: number): Promise<void> {
  const key = cooldownKeyFor(apiKey);
  const until = Date.now() + DNSHE_COOLDOWN_TTL_SECONDS * 1000;
  const payload = JSON.stringify({ until, at: new Date().toISOString(), status });
  // 始终写内存（同一 isolate 内的后续请求可立即命中，不必等 D1 往返）
  memoryCooldownByKey.set(key, until);
  if (!cooldownStore) return;
  try {
    await cooldownStore.set(key, payload, DNSHE_COOLDOWN_TTL_SECONDS);
  } catch {
    // 冷却写失败不应让主流程报错 —— 内存标记已生效
  }
}

/** 当前是否处于冷却期（毫秒时间戳，0 表示未冷却） */
export async function getDnsheCooldownUntil(apiKey = ""): Promise<number> {
  const until = await readCooldownUntil(apiKey);
  return until > Date.now() ? until : 0;
}

/** 清除冷却（设置页手动恢复 / 测试用）。不传 apiKey 则清空全部。 */
export async function clearDnsheCooldown(apiKey?: string): Promise<void> {
  const keys = apiKey === undefined
    ? [...memoryCooldownByKey.keys()]
    : [cooldownKeyFor(apiKey)];

  for (const key of keys) {
    memoryCooldownByKey.delete(key);
    if (cooldownStore) {
      try {
        await cooldownStore.set(key, JSON.stringify({ until: 0 }), 1);
      } catch {
        /* ignore */
      }
    }
  }
}

// ============================================================================
// 429 / 520 判定辅助
// ============================================================================

/** 无法从 reset_at 推导 fallback 时的默认退避 */
const RATE_LIMIT_FALLBACK_WAIT_MS = 2000;
/** 单次请求内最多重试次数（429） */
const RATE_LIMIT_MAX_RETRIES = 2;
/** 单次重试允许的最长等待，超过则直接抛错，避免阻塞 Worker */
const RATE_LIMIT_MAX_WAIT_MS = 5000;

/**
 * 解析 reset_at（北京时间 "YYYY-MM-DD HH:mm:ss"）为毫秒时间戳
 *
 * NOTE: 必须显式带 +08:00。若用 `new Date(str)` 或本地时区解析，
 * 在 UTC 环境会算出 8 小时误差，导致退避时长完全错误。
 */
export function parseDnsheResetAt(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
  return Number.isFinite(ts) ? ts : null;
}

/** 520/521/522/523/524 都视为「上游不可达」 */
function isOriginFailureStatus(status: number): boolean {
  return status === 520 || status === 521 || status === 522 || status === 523 || status === 524;
}

// ============================================================================
// 客户端
// ============================================================================

/**
 * DNSHE API 请求封装类
 */
export class DNSHEClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(apiKey: string, apiSecret: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl || "https://api005.dnshe.com/index.php";
  }

  /**
   * 通用请求封装 — 支持泛型返回值类型
   *
   * 处理顺序（顺序不可调换）：
   *   1. 冷却检查 —— 命中直接抛错，一个字节都不发给上游
   *   2. 领取时间片 —— 全局 2.2s 间隔
   *   3. 发请求
   *   4. 429 → 按 reset_at 退避重试（最多 2 次）
   *   5. 520 → 写冷却 + 抛 DnsheOriginError（绝不重试）
   *   6. 401 → 抛 DnsheAuthError
   */
  private async request<T extends BaseResponse>(
    endpoint: string,
    action: string,
    method: "GET" | "POST",
    params: Record<string, unknown> = {}
  ): Promise<T> {
    let url = `${this.baseUrl}?m=domain_hub&endpoint=${endpoint}&action=${action}`;

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "X-API-Secret": this.apiSecret,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (method === "GET") {
      const queryParams = new URLSearchParams();
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          queryParams.append(key, String(val));
        }
      }
      const queryString = queryParams.toString();
      if (queryString) {
        url += `&${queryString}`;
      }
    } else {
      options.body = JSON.stringify(params);
    }

    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      // 1. 冷却检查：上游已知不可达时不再发请求
      const cooldownUntil = await readCooldownUntil(this.apiKey);
      if (cooldownUntil > Date.now()) {
        const remainSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
        throw new DnsheOriginError(
          `DNSHE 上游服务异常，已进入冷却（剩余约 ${remainSec} 秒），本次跳过`,
          520
        );
      }

      // 2. 领取该 API Key 的时间片（限流按 Key 独立计算，故按 Key 分桶）
      await acquireSlot(this.apiKey);

      try {
        const response = await fetch(url, options);

        // ── 429：限流，可按 reset_at 退避重试 ──
        if (response.status === 429) {
          const errData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          const details = (errData.details || {}) as Record<string, unknown>;
          const limit = Number(details.limit ?? errData.limit ?? 30) || 30;
          const resetAt = parseDnsheResetAt(details.reset_at ?? errData.reset_at);

          if (attempt < RATE_LIMIT_MAX_RETRIES) {
            const wait = resetAt
              ? Math.min(Math.max(resetAt - Date.now(), 500), RATE_LIMIT_MAX_WAIT_MS)
              : RATE_LIMIT_FALLBACK_WAIT_MS;
            // reset_at 远在未来时不要傻等 —— 直接抛错让调用方稍后重试
            const rawWait = resetAt ? resetAt - Date.now() : RATE_LIMIT_FALLBACK_WAIT_MS;
            if (rawWait > RATE_LIMIT_MAX_WAIT_MS) {
              throw new DnsheRateLimitError(
                `DNSHE API 请求频率超限（${limit} 次/分钟），约 ${Math.ceil(rawWait / 1000)} 秒后可重试`,
                resetAt,
                limit
              );
            }
            console.warn(
              `DNSHE 限流 429 [${endpoint}/${action}]，${wait}ms 后重试（第 ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES} 次）`
            );
            await sleep(wait);
            continue;
          }

          throw new DnsheRateLimitError(
            `DNSHE API 请求频率超限（${limit} 次/分钟），请稍后重试`,
            resetAt,
            limit
          );
        }

        // ── 520 及同族：上游不可达，写冷却并立即失败 ──
        if (isOriginFailureStatus(response.status)) {
          const bodyText = await response.text().catch(() => "");
          await writeCooldown(this.apiKey, response.status);
          console.error(
            `DNSHE 上游不可达 [${endpoint}/${action}]: HTTP ${response.status} ${bodyText.slice(0, 60)}`
          );
          throw new DnsheOriginError(
            `DNSHE 上游服务异常（HTTP ${response.status}），已进入冷却，请稍后重试`,
            response.status,
            bodyText.slice(0, 200)
          );
        }

        // ── 401：凭证问题，提示换 Key ──
        if (response.status === 401) {
          const errData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          const msg =
            (typeof errData.message === "string" && errData.message) || "Invalid API credentials";
          throw new DnsheAuthError(`DNSHE 凭证无效：${msg}`);
        }

        // ── 其它错误 ──
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          const errMsg =
            (typeof errData.message === "string" && errData.message) ||
            (typeof errData.msg === "string" && errData.msg) ||
            (typeof errData.error === "string" && errData.error) ||
            (typeof errData.detail === "string" && errData.detail) ||
            `HTTP error! status: ${response.status}`;
          throw new Error(errMsg);
        }

        const data: T = await response.json();
        return data;
      } catch (error: unknown) {
        // 已分类的错误直接抛，不再包装
        if (
          error instanceof DnsheOriginError ||
          error instanceof DnsheRateLimitError ||
          error instanceof DnsheAuthError
        ) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`DNSHE API Error [${endpoint}/${action}]:`, message);
        throw error;
      }
    }

    // 理论上不可达：循环内要么 return，要么 throw
    throw new DnsheRateLimitError();
  }

  /**
   * 获取账号额度配额
   */
  async getQuota(): Promise<QuotaResponse> {
    return this.request<QuotaResponse>("quota", "", "GET");
  }

  /**
   * 列出当前账号的 API 密钥列表
   * 可用于校验密钥有效性，并从中读取密钥名称 (key_name) 作为账户别名
   */
  async listApiKeys(): Promise<ListApiKeysResponse> {
    return this.request<ListApiKeysResponse>("keys", "list", "GET");
  }

  /**
   * 列出子域名列表 (支持分页和搜索)
   */
  async listSubdomains(page = 1, perPage = 100, search = "", status = ""): Promise<ListSubdomainsResponse> {
    return this.request<ListSubdomainsResponse>("subdomains", "list", "GET", {
      page,
      per_page: perPage,
      search: search || undefined,
      status: status || undefined,
      include_total: 1,
    });
  }

  /**
   * 注册新的子域名
   */
  async registerSubdomain(subdomain: string, rootdomain: string): Promise<RegisterSubdomainResponse> {
    return this.request<RegisterSubdomainResponse>("subdomains", "register", "POST", {
      subdomain,
      rootdomain,
    });
  }

  /**
   * 获取子域名详情 (含解析记录)
   *
   * NOTE: 解析记录在 `dns_records` 字段（文档 1.3），不是 `records`。
   */
  async getSubdomain(subdomainId: number): Promise<GetSubdomainResponse> {
    return this.request<GetSubdomainResponse>("subdomains", "get", "GET", {
      subdomain_id: subdomainId,
    });
  }

  /**
   * 续期子域名
   */
  async renewSubdomain(subdomainId: number): Promise<RenewResponse> {
    return this.request<RenewResponse>("subdomains", "renew", "POST", {
      subdomain_id: subdomainId,
    });
  }

  /**
   * 删除子域名
   */
  async deleteSubdomain(subdomainId: number): Promise<ActionResponse> {
    return this.request<ActionResponse>("subdomains", "delete", "POST", {
      subdomain_id: subdomainId,
    });
  }

  /**
   * 列出子域名的 DNS 解析记录
   *
   * NOTE: 参数放宽为 number | string —— 路由层对 DNSHE / Cloudflare 客户端做联合分发时
   * 传同一个 remote_id（DNSHE 行是数字主键，CF 行是 zone id 字符串），实际只走数字。
   */
  async listDnsRecords(subdomainId: number | string): Promise<ListDnsRecordsResponse> {
    return this.request<ListDnsRecordsResponse>("dns_records", "list", "GET", {
      subdomain_id: subdomainId,
    });
  }

  /**
   * 创建 DNS 解析记录
   *
   * NOTE: 上游只回 `id` / `record_id`，不回完整记录对象。需要完整数据请再 list 一次。
   */
  async createDnsRecord(params: CreateDnsRecordParams): Promise<CreateDnsRecordResponse> {
    return this.request<CreateDnsRecordResponse>(
      "dns_records",
      "create",
      "POST",
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * 修改 DNS 解析记录
   *
   * NOTE: 与删除接口一致 —— 记录标识为纯数字时同时以内部 id 和 record_id 两种
   * 形式下发，兼容上游对两种字段的不同要求。
   */
  async updateDnsRecord(params: UpdateDnsRecordParams): Promise<ActionResponse> {
    const payload: Record<string, unknown> = { ...params };
    const numId = Number(params.record_id);
    if (!isNaN(numId) && numId > 0) {
      payload.id = numId;
    }
    payload.record_id = String(params.record_id);

    return this.request<ActionResponse>("dns_records", "update", "POST", payload);
  }

  /**
   * 删除 DNS 解析记录
   *
   * NOTE: subdomainId 放宽为 number | string，理由同 listDnsRecords。
   * 上游按 `record_id` / `id` 定位，`subdomain_id` 是冗余参数（文档未定义），
   * 保留仅为兼容旧行为。
   */
  async deleteDnsRecord(subdomainId: number | string, recordId: string | number): Promise<ActionResponse> {
    const params: Record<string, unknown> = {
      subdomain_id: subdomainId,
    };

    const numId = Number(recordId);
    if (!isNaN(numId) && numId > 0) {
      params.id = numId;
      params.record_id = String(recordId);
    } else {
      params.record_id = String(recordId);
    }

    return this.request<ActionResponse>("dns_records", "delete", "POST", params);
  }

  /**
   * WHOIS 查询域名可注册性
   */
  async whois(domain: string): Promise<{
    success: boolean;
    domain?: string;
    registered?: boolean;
    status?: string;
    registered_at?: string;
    expires_at?: string;
    registrant_email?: string;
    nameservers?: string[];
    message?: string;
  }> {
    return this.request<{
      success: boolean;
      domain?: string;
      registered?: boolean;
      status?: string;
      registered_at?: string;
      expires_at?: string;
      registrant_email?: string;
      nameservers?: string[];
      message?: string;
    }>("whois", "", "GET", {
      domain,
    });
  }
}
