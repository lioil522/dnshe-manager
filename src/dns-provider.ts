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
