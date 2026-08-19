/**
 * DNS 解析记录的类型清单与写入前的数据整理
 *
 * 集中三类与界面无关的纯逻辑，便于单独验证：
 *   1. 主机记录相对名转换（上游读回完整域名、写入只收相对名）
 *   2. 「批量添加」纯文本解析（可省略类型 / 主机记录，TTL 与优先级可写在行尾）
 *   3. 「批量修改」字段合并（勾选的字段用新值，其余字段沿用每条记录的原值）
 */

import { toASCII } from "./punycode";

/** 解析记录类型选项（新建 / 修改 / 批量添加 / 批量修改共用同一份清单） */
export const DNS_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "A", label: "A (IPv4地址)" },
  { value: "AAAA", label: "AAAA (IPv6地址)" },
  { value: "CNAME", label: "CNAME (别名指向)" },
  { value: "TXT", label: "TXT (文本记录)" },
  { value: "MX", label: "MX (邮件服务器)" },
  { value: "NS", label: "NS (域名服务器)" },
  { value: "CAA", label: "CAA (证书签发限制)" },
  { value: "SRV", label: "SRV (服务定位)" },
];

const DNS_TYPE_SET = new Set(DNS_TYPE_OPTIONS.map((o) => o.value));

/** 只有 MX / SRV 需要优先级，其余类型不展示也不下发该字段 */
export const needsDnsPriority = (type: string): boolean => type === "MX" || type === "SRV";

/** 批量修改需要读到的记录字段（与 App.tsx 的 DnsRecord 结构兼容） */
export interface DnsRecordLike {
  id?: number;
  record_id?: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  line?: string | null;
}

/** 单条解析记录在前端的唯一键（上游同时可能给出内部 id 与 record_id） */
export const dnsRecordKey = (rec: DnsRecordLike): string => String(rec.id ?? rec.record_id ?? "");

/**
 * 把主机记录转为上游写接口要求的相对名
 *
 * NOTE: 上游 dns_records/list 返回的 name 是完整域名（`ipv6.1.cd`），而写接口只收
 * `@` 或相对名（`jp`）。直接把完整域名回填到编辑框，用户改一下就会提交出
 * `jp.ipv6.1.cd` 这种被明确拒绝的写法（"full domain names are not accepted"）。
 * 统一转 ASCII 小写，与「中文域名统一转 xn-- 后送往上游」的既有约定一致。
 * 后端 normalizeDnsRecordName 还会再兜一层，这里主要保证界面显示与实际写入一致。
 */
export function toRelativeRecordName(name: string, fullDomain: string): string {
  const trimmed = toASCII(String(name || "").trim()).toLowerCase().replace(/\.+$/, "");
  const base = toASCII(String(fullDomain || "").trim()).toLowerCase().replace(/\.+$/, "");
  if (!trimmed || trimmed === "@" || trimmed === base) return "@";
  if (base && trimmed.endsWith(`.${base}`)) {
    return trimmed.slice(0, -(base.length + 1)) || "@";
  }
  return trimmed;
}

/** 批量添加时从一行文本解析出的记录 */
export interface ParsedDnsLine {
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
}

/** 每行缺省字段所取的默认值（对应批量添加面板上方的几个输入框） */
export interface DnsLineDefaults {
  type: string;
  name: string;
  ttl: number;
  priority: number;
}

/**
 * 解析「批量添加解析记录」输入框的一行文本，无法解析（没有记录值）时返回 null
 *
 * 字段分隔符优先级：竖线 > 逗号 > 空白 —— TXT 记录值本身含空格时，改用竖线或逗号分隔即可。
 * 支持的写法（缺省字段一律取 defaults；示例地址取自文档保留段）：
 *   192.0.2.1                      仅记录值
 *   www 192.0.2.1                  主机记录 + 记录值
 *   A www 192.0.2.1 600            显式类型 + TTL
 *   MX @ mail.example.com 600 10   行尾两个纯数字依次为 TTL、优先级
 *
 * NOTE: 顺序是「先取主机记录，再从行尾剥离数字，且始终至少留一个字段作为记录值」——
 * 反过来先剥数字的话，`TXT @ 12345` 这类记录值本身是数字的行会把记录值误当成 TTL。
 */
export function parseDnsBatchLine(raw: string, defaults: DnsLineDefaults): ParsedDnsLine | null {
  const line = raw.trim();
  if (!line) return null;

  const splitter = line.includes("|") ? /\|+/ : /[,，]/.test(line) ? /[,，]+/ : /\s+/;
  const tokens = line.split(splitter).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  let type = defaults.type;
  if (tokens.length > 1 && DNS_TYPE_SET.has(tokens[0].toUpperCase())) {
    type = tokens.shift()!.toUpperCase();
  }

  let name = defaults.name.trim() || "@";
  if (tokens.length > 1) {
    name = tokens.shift()!;
  }

  const nums: number[] = [];
  while (tokens.length > 1 && nums.length < 2 && /^\d+$/.test(tokens[tokens.length - 1])) {
    nums.unshift(Number(tokens.pop()));
  }

  const content = tokens.join(" ").trim();
  if (!content) return null;

  const parsed: ParsedDnsLine = {
    type,
    name,
    content,
    ttl: nums[0] && nums[0] > 0 ? nums[0] : defaults.ttl,
  };
  if (needsDnsPriority(type)) {
    parsed.priority = nums[1] !== undefined ? nums[1] : defaults.priority;
  }
  return parsed;
}

/**
 * 解析整个批量添加输入框：按行拆分，跳过空行与 `#` 注释行。
 * 返回每行的解析结果（含 null），由调用方据此提示"有几行被跳过"。
 */
export function parseDnsBatchInput(text: string, defaults: DnsLineDefaults): Array<ParsedDnsLine | null> {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => parseDnsBatchLine(l, defaults));
}

/** 批量修改面板里「哪些字段要被覆盖」的勾选状态 */
export interface DnsEditFieldFlags {
  type: boolean;
  name: boolean;
  content: boolean;
  ttl: boolean;
  line: boolean;
  priority: boolean;
}

/** 批量修改面板里填的新值 */
export interface DnsEditOverrides {
  type: string;
  name: string;
  content: string;
  ttl: number;
  line: string;
  priority: number;
}

/** 合并后送往后端的整条记录 */
export interface DnsEditTarget {
  record_id: string;
  /** 原记录的可读描述，预览与回执里用来对照改了哪一条 */
  label: string;
  /** 原记录值，作为「逐条编辑记录值」输入框的默认值 */
  origin_content: string;
  /** 合并后与原记录逐字段一致 —— 提交时跳过，不必为没变化的记录白跑一次上游 */
  unchanged: boolean;
  type: string;
  name: string;
  content: string;
  ttl: number;
  line?: string;
  priority?: number;
}

/**
 * 批量修改：把面板上的新值合并进每条选中记录
 *
 * NOTE: 只有 flags 里为 true 的字段才用新值，其余字段沿用该条记录的原值 ——
 * 批量选中的记录往往只有 TTL / 线路 需要统一，记录值各不相同（如 6 条不同 IP 的
 * AAAA），整表覆盖会把它们改成一模一样。上游 update 是整条覆盖语义，所以这里
 * 必须把每条记录的完整字段都算出来，而不是只发变化的那几个。
 *
 * 记录值是唯一支持「逐条给不同新值」的字段（contentOverrides，键为 record_id）：
 * 勾选记录值后界面允许逐行编辑，没给或给空串的行沿用自己的原值。
 */
export function buildDnsEditTargets(
  records: DnsRecordLike[],
  flags: DnsEditFieldFlags,
  overrides: DnsEditOverrides,
  fullDomain: string,
  contentOverrides: Record<string, string> = {}
): DnsEditTarget[] {
  return records.map((rec) => {
    const key = dnsRecordKey(rec);
    const originName = toRelativeRecordName(rec.name, fullDomain);
    const originLine = (rec.line || "").trim() || undefined;
    const originPriority = needsDnsPriority(rec.type)
      ? rec.priority ?? undefined
      : undefined;

    const type = flags.type ? overrides.type : rec.type;
    const name = flags.name ? toRelativeRecordName(overrides.name, fullDomain) : originName;
    // 逐条记录值：留空视为「保持原值」，避免把记录值写成空串
    const content = flags.content
      ? (contentOverrides[key] ?? "").trim() || rec.content
      : rec.content;
    const ttl = flags.ttl ? overrides.ttl : rec.ttl;
    const line = (flags.line ? overrides.line : rec.line || "").trim() || undefined;
    // 类型被改成非 MX / SRV 时原优先级自然失效，只在仍需要时才带上
    const priority = needsDnsPriority(type)
      ? flags.priority
        ? overrides.priority
        : rec.priority ?? 10
      : undefined;

    const normalizedTtl = ttl > 0 ? ttl : 600;
    const unchanged =
      type === rec.type &&
      name === originName &&
      content === rec.content &&
      normalizedTtl === rec.ttl &&
      line === originLine &&
      priority === originPriority;

    return {
      record_id: key,
      label: `${rec.type} ${rec.name} → ${rec.content}`,
      origin_content: rec.content,
      unchanged,
      type,
      name,
      content,
      ttl: normalizedTtl,
      line,
      priority,
    };
  });
}
