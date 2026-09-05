/**
 * Cloudflare API v4 响应类型定义与客户端封装
 *
 * NOTE: 与 DNSHEClient 保持同一套 DNS 记录方法签名（listDnsRecords / createDnsRecord /
 * updateDnsRecord / deleteDnsRecord），index.ts 路由层按账号 provider 分发时无需关心
 * 上游差异。认证只支持 API Token（Bearer）—— Global API Key 属于旧式凭据，不做兼容。
 */

import type {
  ActionResponse,
  CreateDnsRecordResponse,
  DnsRecordInfo,
  ListDnsRecordsResponse,
} from "./dnshe";
import type { UpstreamSubdomain } from "./db";

/**
 * 把 Cloudflare zone id 映射为 domains_cache 的数值主键
 *
 * NOTE: domains_cache.id 直接充当路由里的域名 ID，而 CF zone id 是 32 位十六进制
 * 字符串，无法做 INTEGER 主键。这里用双 FNV-1a 拼出一个 53 位稳定哈希：
 * 同一 zone 每次同步得到相同 id（幂等 upsert），不同 zone 几乎不会碰撞；
 * 哈希值远大于 DNSHE 的小整数 subdomain_id，两个提供商的 id 空间实际不相交。
 */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function zoneIdToNumericId(zoneId: string): number {
  const h1 = fnv1a32(zoneId, 0x811c9dc5);
  const h2 = fnv1a32(zoneId, 0x811c9dc5 ^ 0x9e3779b9);
  return h1 * 0x200000 + (h2 % 0x200000); // 2^32 * 2^21 = 2^53，落在 JS 安全整数内
}

/** Cloudflare API v4 统一响应外壳 */
interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages?: unknown[];
  result?: T;
}

/** zone 信息（listZones 返回，只保留面板需要的字段） */
export interface CfZoneInfo {
  id: string;
  name: string;
  status: string;
  created_on?: string;
  name_servers?: string[];
  account?: { id?: string; name?: string };
}

/** Token 校验结果（/user/tokens/verify） */
export interface CfTokenVerifyInfo {
  token_id: string;
  status: string;
}

/** Cloudflare 账号信息（listAccounts 返回） */
export interface CfAccountInfo {
  id: string;
  name: string;
}

/** DNS 记录写接口参数 —— 路由层从请求体摊平后构造，name 允许相对名/完整名/@ */
export interface CfDnsWriteParams {
  zone_id: string;
  zone_name: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  record_id?: string | number;
}

/** Cloudflare 返回的 DNS 记录原始形状（只声明会用到的字段） */
interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  proxied?: boolean;
}

/**
 * 把主机记录转成 Cloudflare 要求的完整域名
 *
 * NOTE: 路由层的 normalizeDnsRecordName 已把输入统一成 @ / 相对名（ASCII 小写），
 * 这里只需补全 zone 后缀；name 传来时已是完整名（例如批量编辑回填）则原样保留。
 */
function toFqdnRecordName(name: string, zoneName: string): string {
  const zone = String(zoneName || "").trim().replace(/\.+$/, "").toLowerCase();
  const trimmed = String(name || "").trim().replace(/\.+$/, "").toLowerCase();
  if (!trimmed || trimmed === "@") {
    return zone;
  }
  if (!zone || trimmed === zone || trimmed.endsWith(`.${zone}`)) {
    return trimmed;
  }
  return `${trimmed}.${zone}`;
}

/** 把 Cloudflare 记录映射为与 DNSHE 一致的内部形状 */
function mapCfRecord(rec: CfDnsRecord): DnsRecordInfo {
  return {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    content: rec.content,
    // Cloudflare 以 ttl=1 表示「自动」，前端据此显示「自动」
    ttl: Number(rec.ttl) || 1,
    priority: rec.priority ?? null,
    line: null,
    proxied: Boolean(rec.proxied),
  };
}

/**
 * 把 Cloudflare zone 映射为 domains_cache 的上游行
 *
 * NOTE: status 直接存 zone 的原始状态（active/pending/moved），这些行只在 Cloudflare
 * 标签页展示，由该页面自己渲染状态徽标，不走 DNSHE 的三态语义。expires_at 用 0000
 * 前缀占位，前端 formatDate 会显示成「永久」。数值主键由 zoneIdToNumericId（db.ts）产出。
 */
export function mapZoneToUpstream(zone: CfZoneInfo): UpstreamSubdomain {
  return {
    id: zoneIdToNumericId(zone.id),
    subdomain: "",
    rootdomain: zone.name,
    full_domain: zone.name,
    status: zone.status || "active",
    created_at: zone.created_on || "",
    expires_at: "0000-00-00 00:00:00",
    has_dns: 1,
    dns_provider: "Cloudflare",
    remote_id: zone.id,
    dns_state_known: true
  };
}

/**
 * Cloudflare API 请求封装类
 */
export class CloudflareClient {
  private apiToken: string;
  private baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(apiToken: string) {
    this.apiToken = String(apiToken || "").trim();
  }

  /**
   * 通用请求封装 —— 非 2xx 或 success=false 时抛出带 CF 错误信息的异常
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    query?: Record<string, unknown>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== null && val !== "") {
          url.searchParams.append(key, String(val));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let data: CfResponse<T>;
    try {
      data = (await response.json()) as CfResponse<T>;
    } catch {
      throw new Error(`Cloudflare API 响应异常 (HTTP ${response.status})`);
    }

    if (!response.ok || !data.success) {
      const detail = (data.errors || [])
        .map((err) => err?.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(`Cloudflare API 错误: ${detail || `HTTP ${response.status}`}`);
    }

    return data.result as T;
  }

  /**
   * 校验 API Token 有效性（返回 Token 自身 id 与 active 状态）
   */
  async verifyToken(): Promise<CfTokenVerifyInfo> {
    const result = await this.request<{ id: string; status: string }>("GET", "/user/tokens/verify");
    return { token_id: result.id, status: result.status };
  }

  /**
   * 列出 Token 可访问的 Cloudflare 账号（用于别名解析与唯一键）
   */
  async listAccounts(): Promise<CfAccountInfo[]> {
    const accounts: CfAccountInfo[] = [];
    let page = 1;
    while (page <= 10) {
      const results = await this.request<CfAccountInfo[]>("GET", "/accounts", { page, per_page: 50 });
      accounts.push(...(results || []));
      if (!results || results.length < 50) break;
      page++;
    }
    return accounts;
  }

  /**
   * 分页列出账号下全部 zone
   */
  async listZones(): Promise<CfZoneInfo[]> {
    const zones: CfZoneInfo[] = [];
    let page = 1;
    while (page <= 50) {
      const results = await this.request<CfZoneInfo[]>("GET", "/zones", { page, per_page: 50 });
      zones.push(...(results || []));
      if (!results || results.length < 50) break;
      page++;
    }
    return zones;
  }

  /**
   * 列出 zone 下全部 DNS 解析记录（分页拉全，映射为内部形状）
   */
  async listDnsRecords(zoneId: string | number): Promise<ListDnsRecordsResponse> {
    const records: DnsRecordInfo[] = [];
    let page = 1;
    while (page <= 50) {
      const results = await this.request<CfDnsRecord[]>(
        "GET",
        `/zones/${encodeURIComponent(String(zoneId))}/dns_records`,
        { page, per_page: 100 }
      );
      records.push(...(results || []).map(mapCfRecord));
      if (!results || results.length < 100) break;
      page++;
    }
    return { success: true, records };
  }

  /**
   * 根据写参数构造 CF 请求体：相对名转完整域名、代理记录强制自动 TTL、
   * MX 缺省优先级时从内容前缀解析、SRV 转为 data 对象格式
   */
  private buildWritePayload(params: CfDnsWriteParams): Record<string, unknown> {
    const type = String(params.type || "").trim().toUpperCase();
    const name = toFqdnRecordName(params.name, params.zone_name);
    let content = String(params.content || "").trim();

    const payload: Record<string, unknown> = {
      type,
      name,
      content,
      // 开启代理（橙色云）时 Cloudflare 只接受自动 TTL (1)
      ttl: params.proxied ? 1 : (Number(params.ttl) > 0 ? Number(params.ttl) : 1),
      proxied: Boolean(params.proxied),
    };

    if (type === "MX") {
      let priority = Number(params.priority);
      // 兼容「10 mail.example.com」写法：内容前缀的数字视作优先级
      if (!Number.isFinite(priority) || priority < 0) {
        const match = content.match(/^(\d+)\s+(.+)$/);
        if (match) {
          priority = Number(match[1]);
          content = match[2];
        }
      }
      payload.content = content;
      if (Number.isFinite(priority) && priority >= 0) {
        payload.priority = priority;
      }
    }

    if (type === "SRV") {
      // Cloudflare 的 SRV 记录要求通过 data 对象提交：priority weight port target
      const parts = content.split(/\s+/).filter(Boolean);
      if (parts.length === 4) {
        payload.data = {
          priority: Number.isFinite(Number(params.priority)) ? Number(params.priority) : Number(parts[0]),
          weight: Number(parts[1]),
          port: Number(parts[2]),
          target: parts[3],
        };
        delete payload.content;
      }
    }

    return payload;
  }

  /**
   * 创建 DNS 解析记录
   */
  async createDnsRecord(params: CfDnsWriteParams): Promise<CreateDnsRecordResponse> {
    const record = await this.request<CfDnsRecord>(
      "POST",
      `/zones/${encodeURIComponent(params.zone_id)}/dns_records`,
      undefined,
      this.buildWritePayload(params)
    );
    return { success: true, record: mapCfRecord(record) };
  }

  /**
   * 修改 DNS 解析记录（PUT 整条覆盖，与 DNSHE 上游的整条覆盖语义一致）
   */
  async updateDnsRecord(params: CfDnsWriteParams): Promise<ActionResponse> {
    await this.request(
      "PUT",
      `/zones/${encodeURIComponent(params.zone_id)}/dns_records/${encodeURIComponent(String(params.record_id))}`,
      undefined,
      this.buildWritePayload(params)
    );
    return { success: true };
  }

  /**
   * 删除 DNS 解析记录
   */
  async deleteDnsRecord(zoneId: string | number, recordId: string | number): Promise<ActionResponse> {
    await this.request(
      "DELETE",
      `/zones/${encodeURIComponent(String(zoneId))}/dns_records/${encodeURIComponent(String(recordId))}`
    );
    return { success: true };
  }
}
