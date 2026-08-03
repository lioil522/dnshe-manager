/**
 * 轻量级 Punycode / IDNA 编码工具 (RFC 3492)
 *
 * Cloudflare Worker 运行时不保证内置 Node.js 的 `punycode` 模块，因此这里提供一份
 * 零依赖、可在 Worker 与浏览器双端复用的纯 TypeScript 实现，用于把中文等非 ASCII
 * 域名转换为 `xn--` 前缀的 ASCII 形式，供上游 DNSHE API 使用。
 */

// RFC 3492 Bootstring 参数（针对 Punycode 的固定取值）
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128; // 0x80，非 ASCII 起始码点
const DELIMITER = "-";

// 仅包含 ASCII 字母数字与连字符的正则（合法 LDH 标签）
const NON_ASCII = /[^\x00-\x7F]/;

/**
 * 将 Unicode 码点数组按 UTF-16 拆解为完整码点（正确处理 emoji / 代理对）
 */
function ucs2decode(str: string): number[] {
  const output: number[] = [];
  let i = 0;
  while (i < str.length) {
    const value = str.charCodeAt(i++);
    if (value >= 0xd800 && value <= 0xdbff && i < str.length) {
      const extra = str.charCodeAt(i++);
      if ((extra & 0xfc00) === 0xdc00) {
        output.push(((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000);
      } else {
        output.push(value);
        i--;
      }
    } else {
      output.push(value);
    }
  }
  return output;
}

/**
 * 计算数字值对应的 Punycode 基础字符（0-25 => a-z，26-35 => 0-9）
 */
function digitToBasic(digit: number): number {
  return digit + 22 + 75 * (digit < 26 ? 1 : 0);
}

/**
 * RFC 3492 定义的偏差自适应函数
 */
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

/**
 * 将单个 Unicode 标签编码为 Punycode（不含 `xn--` 前缀）
 */
function encodeLabel(input: string): string {
  const codePoints = ucs2decode(input);
  const inputLength = codePoints.length;

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  const output: string[] = [];

  // 先原样输出所有 ASCII（基础）码点
  for (const cp of codePoints) {
    if (cp < 0x80) output.push(String.fromCharCode(cp));
  }

  const basicLength = output.length;
  let handledCPCount = basicLength;

  if (basicLength) output.push(DELIMITER);

  while (handledCPCount < inputLength) {
    let m = Infinity;
    for (const cp of codePoints) {
      if (cp >= n && cp < m) m = cp;
    }

    if (m - n > Math.floor((Infinity - delta) / (handledCPCount + 1))) {
      throw new RangeError("Punycode 溢出：输入内容过长");
    }

    delta += (m - n) * (handledCPCount + 1);
    n = m;

    for (const cp of codePoints) {
      if (cp < n && ++delta > 0xffffffff) {
        throw new RangeError("Punycode 溢出：输入内容过长");
      }
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          const qMinusT = q - t;
          const baseMinusT = BASE - t;
          output.push(String.fromCharCode(digitToBasic(t + (qMinusT % baseMinusT))));
          q = Math.floor(qMinusT / baseMinusT);
        }
        output.push(String.fromCharCode(digitToBasic(q)));
        bias = adapt(delta, handledCPCount + 1, handledCPCount === basicLength);
        delta = 0;
        handledCPCount++;
      }
    }

    delta++;
    n++;
  }

  return output.join("");
}

/**
 * 将单个域名标签（点号分隔的一段）转换为 ASCII 形式：
 * 含非 ASCII 字符则加 `xn--` 前缀，否则原样返回（并转小写）。
 */
function labelToASCII(label: string): string {
  if (!NON_ASCII.test(label)) return label.toLowerCase();
  return "xn--" + encodeLabel(label.toLowerCase());
}

/**
 * 将 Punycode 基础字符还原为对应的数字值（a-z => 0-25，0-9 => 26-35）
 */
function basicToDigit(codePoint: number): number {
  if (codePoint - 48 < 10) return codePoint - 22; // 0-9
  if (codePoint - 65 < 26) return codePoint - 65; // A-Z
  if (codePoint - 97 < 26) return codePoint - 97; // a-z
  return BASE;
}

/**
 * 将单个 Punycode 标签（不含 `xn--` 前缀）解码回 Unicode 字符串
 */
function decodeLabel(input: string): string {
  const output: number[] = [];
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;

  // 最后一个分隔符之前的部分是原样保留的基础码点
  const basicEnd = input.lastIndexOf(DELIMITER);
  const basic = basicEnd > 0 ? basicEnd : 0;
  for (let j = 0; j < basic; j++) {
    const cp = input.charCodeAt(j);
    if (cp >= 0x80) throw new RangeError("Punycode 解码失败：出现非法字符");
    output.push(cp);
  }

  let index = basic > 0 ? basic + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError("Punycode 解码失败：输入不完整");
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= BASE) throw new RangeError("Punycode 解码失败：出现非法字符");
      if (digit > Math.floor((0x7fffffff - i) / w)) throw new RangeError("Punycode 溢出");
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(0x7fffffff / (BASE - t))) throw new RangeError("Punycode 溢出");
      w *= BASE - t;
    }

    const outLen = output.length + 1;
    bias = adapt(i - oldi, outLen, oldi === 0);
    if (Math.floor(i / outLen) > 0x7fffffff - n) throw new RangeError("Punycode 溢出");
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i++, 0, n);
  }

  return String.fromCodePoint(...output);
}

/**
 * 将一个完整域名（可含多级、可含中文）转换为纯 ASCII 的 Punycode 形式。
 *
 * - 逐段处理点号分隔的标签，只有含非 ASCII 字符的标签才会被编码
 * - 已是 ASCII 的输入原样返回（仅转小写并去除首尾空白）
 * - 兼容中文句号「。」，会先归一化为半角点号
 */
export function toASCII(domain: string): string {
  if (!domain) return domain;
  const normalized = domain.trim().replace(/[。．｡]/g, ".");
  return normalized
    .split(".")
    .map((label) => (label ? labelToASCII(label) : label))
    .join(".");
}

/**
 * 判断字符串是否包含需要 Punycode 编码的非 ASCII 字符
 */
export function hasNonASCII(input: string): boolean {
  return NON_ASCII.test(input);
}

/**
 * 将一个完整域名从 Punycode (`xn--`) 形式还原为可读的 Unicode 形式。
 *
 * - 逐段处理点号分隔的标签，只有 `xn--` 前缀的标签才会被解码
 * - 非 `xn--` 标签原样返回
 * - 解码失败（非法 Punycode）时该标签原样保留，保证展示不至于报错
 */
export function toUnicode(domain: string): string {
  if (!domain) return domain;
  return domain
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return decodeLabel(label.slice(4).toLowerCase());
      } catch {
        return label;
      }
    })
    .join(".");
}
