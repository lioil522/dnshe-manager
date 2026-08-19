/**
 * DNSHE API 响应类型定义
 * 
 * NOTE: 为每个 API 端点定义具体的响应接口，替代原先的 Promise<any> 返回类型，
 * 使所有调用方获得编译期的字段提示和类型校验。
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

/** 子域名列表响应 */
export interface ListSubdomainsResponse extends BaseResponse {
  subdomains?: SubdomainInfo[];
  total?: number;
  page?: number;
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
}

/** 子域名详情响应 */
export interface GetSubdomainResponse extends BaseResponse {
  subdomain?: SubdomainInfo;
  records?: DnsRecordInfo[];
}

/** 续期响应 */
export interface RenewResponse extends BaseResponse {
  new_expires_at?: string;
}

/** DNS 记录列表响应 */
export interface ListDnsRecordsResponse extends BaseResponse {
  records?: DnsRecordInfo[];
}

/** DNS 记录信息 */
export interface DnsRecordInfo {
  id: number;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  line?: string | null;
  proxied?: boolean;
}

/** 创建 DNS 记录响应 */
export interface CreateDnsRecordResponse extends BaseResponse {
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

/**
 * DNSHE API 请求封装类
 */
export class DNSHEClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    // 从文档得知 API 地址
    this.baseUrl = "https://api005.dnshe.com/index.php";
  }

  /**
   * 通用请求封装 — 支持泛型返回值类型
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

    try {
      const response = await fetch(url, options);
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
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`DNSHE API Error [${endpoint}/${action}]:`, message);
      throw error;
    }
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
      include_total: 1
    });
  }

  /**
   * 注册新的子域名
   */
  async registerSubdomain(subdomain: string, rootdomain: string): Promise<RegisterSubdomainResponse> {
    return this.request<RegisterSubdomainResponse>("subdomains", "register", "POST", {
      subdomain,
      rootdomain
    });
  }

  /**
   * 获取子域名详情 (含解析记录)
   */
  async getSubdomain(subdomainId: number): Promise<GetSubdomainResponse> {
    return this.request<GetSubdomainResponse>("subdomains", "get", "GET", {
      subdomain_id: subdomainId
    });
  }

  /**
   * 续期子域名
   */
  async renewSubdomain(subdomainId: number): Promise<RenewResponse> {
    return this.request<RenewResponse>("subdomains", "renew", "POST", {
      subdomain_id: subdomainId
    });
  }

  /**
   * 删除子域名
   */
  async deleteSubdomain(subdomainId: number): Promise<ActionResponse> {
    return this.request<ActionResponse>("subdomains", "delete", "POST", {
      subdomain_id: subdomainId
    });
  }

  /**
   * 列出子域名的 DNS 解析记录
   */
  async listDnsRecords(subdomainId: number): Promise<ListDnsRecordsResponse> {
    return this.request<ListDnsRecordsResponse>("dns_records", "list", "GET", {
      subdomain_id: subdomainId
    });
  }

  /**
   * 创建 DNS 解析记录
   */
  async createDnsRecord(params: CreateDnsRecordParams): Promise<CreateDnsRecordResponse> {
    return this.request<CreateDnsRecordResponse>("dns_records", "create", "POST", params as unknown as Record<string, unknown>);
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
   */
  async deleteDnsRecord(subdomainId: number, recordId: string | number): Promise<ActionResponse> {
    const params: Record<string, unknown> = {
      subdomain_id: subdomainId
    };
    
    // 如果是纯数字或数值型字符串，作为内部 id 传递；同时补充 record_id 保证兼容
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
  async whois(domain: string): Promise<{ success: boolean; domain?: string; registered?: boolean; status?: string; registered_at?: string; expires_at?: string; registrant_email?: string; nameservers?: string[]; message?: string }> {
    return this.request<{ success: boolean; domain?: string; registered?: boolean; status?: string; registered_at?: string; expires_at?: string; registrant_email?: string; nameservers?: string[]; message?: string }>("whois", "", "GET", {
      domain
    });
  }
}
