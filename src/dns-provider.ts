export type DnsProvider = "system" | "Cloudflare" | "DNSPod" | "Vercel" | "vps8" | "external";

function normalizeNameserver(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * 根据域名当前委派的 NS 地址识别 DNS 托管商。
 *
 * NOTE: vps8 使用的是自有 NS 域名，优先于通用服务商规则匹配。
 */
export function detectDnsProvider(nameservers: string[]): DnsProvider {
  const hosts = nameservers.map(normalizeNameserver).filter(Boolean);

  if (hosts.length === 0 || hosts.every((host) => matchesDomain(host, "dnshe.com"))) {
    return "system";
  }

  if (hosts.some((host) => matchesDomain(host, "vps8.zz.cd"))) {
    return "vps8";
  }

  if (hosts.some((host) => matchesDomain(host, "ns.cloudflare.com"))) {
    return "Cloudflare";
  }

  if (hosts.some((host) =>
    matchesDomain(host, "dnspod.net") ||
    matchesDomain(host, "dnspod.com") ||
    matchesDomain(host, "dnsv.com") ||
    /(^|\.)dnsv[1-5]\.com$/.test(host)
  )) {
    return "DNSPod";
  }

  if (hosts.some((host) => matchesDomain(host, "vercel-dns.com"))) {
    return "Vercel";
  }

  return "external";
}

/**
 * 由域名区域内的解析记录推导出缓存所需的三态与托管商信息。
 *
 * NOTE: 域名三态（已委派 / 已解析 / 未解析）只能由真实解析记录推导出来，
 * 上游 subdomains/list 接口返回的 status 只有 active 之类的注册态。
 * 所有写入 domains_cache 的调用方都必须经过这里，dns_state_known 是
 * 「本次确实拿到了解析记录」的凭证 —— 缺少它时 syncAccountDomains
 * 会保留数据库里已有的三态，避免把「已委派」误刷成「已解析」。
 */
export interface DnsState {
  status: "已委派" | "已解析" | "未解析";
  has_dns: number;
  dns_provider: DnsProvider;
  dns_state_known: true;
}

export function computeDnsState(records: Array<{ type?: string; content?: unknown }>): DnsState {
  const dnsProvider = detectDnsProvider(
    records.filter((record) => record.type === "NS").map((record) => String(record.content || ""))
  );

  if (dnsProvider !== "system") {
    return { status: "已委派", has_dns: 0, dns_provider: dnsProvider, dns_state_known: true };
  }
  if (records.length > 0) {
    return { status: "已解析", has_dns: 1, dns_provider: dnsProvider, dns_state_known: true };
  }
  return { status: "未解析", has_dns: 1, dns_provider: dnsProvider, dns_state_known: true };
}
