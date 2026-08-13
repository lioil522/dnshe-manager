/**
 * 批量查重规则引擎（花括号槽位模型）
 *
 * 语法照搬 west.cn：一条规则由若干「槽位」顺序拼接，每个槽位是一个候选串集合，
 * 整条规则的产出 = 各槽位的笛卡尔积。
 *
 *   {字母}{字母}{字母}{字母}   → 26⁴ = 456976 条
 *   my{字母}{数字}             → 字面量 my 是只有 1 个元素的槽位，共 260 条
 *   {3-4位拼音}{数字}          → 293 × 10 = 2930 条
 *
 * 这个模型取代了旧实现里「拼音/CVCV/豹子 直接 return」的短路写法 —— 短路让这些
 * 标签无法与其它标签组合，而槽位模型下它们只是普通的候选串集合。
 *
 * 标签取值全部对齐西部数码客户端反编译源码 Words.DomainWords()，
 * 详见各常量注释与 pinyin.ts / geodata.ts / enwords.ts 的文件头。
 *
 * 三种语法并存，由 parseRule 归一：
 *   1. {声母}{韵母}   花括号（新）
 *   2. 声母+韵母      加号（旧，保留兼容）
 *   3. abc, def       逗号候选列表
 */

import {
  PINYIN_2,
  PINYIN_34,
  PINYIN_56,
  PINYIN_SYLLABLES,
  shuangpinIter
} from "./pinyin";
import { CITY_PINYIN, CITY_ABBR, AREA_CODES, PROVINCE_ABBR } from "./geodata";
import { COMMON_WORDS, NOUNS, VERBS, ADJECTIVES } from "./enwords";
import { ZIP_CODES } from "./zipcodes";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");

/**
 * 以下字符集与整体型标签的取值全部来自西部数码客户端 Words.DomainWords() 的原始定义，
 * 与「按语言学常识推导」的结果有出入之处一律以原始定义为准（差异见各项注释）。
 */

/** {数字无04}：排除 0 和 4 */
const DIGITS_NO_04 = "12356789".split("");

/** {声母}：20 个。注意不含 v —— 汉语拼音没有 v 声母 */
const SHENGMU = "bcdfghjklmnpqrstwxyz".split("");

/**
 * {韵母}：24 个真实韵母，而非 5 个元音字母。
 * 因此 {声母}{韵母} 产出 20×24=480 个可发音音节，而不是 21×5=105 个字母对。
 */
const YUNMU = [
  "a", "o", "e", "i", "u", "v",
  "ai", "ei", "ui", "ao", "ou", "iu", "ie", "ve", "er",
  "an", "en", "in", "un", "vn",
  "ang", "eng", "ing", "ong",
];

/**
 * {2-15位豹子}：44 条。整体排除数字 4（无 44/444/…），且 6 位缺 000000。
 * 这是原表的既有取舍，不是遗漏 —— 4 在域名场景被视为不吉利。
 */
const BAOZI: string[] = [];

for (let len = 2; len <= 15; len++) {
  for (const digit of "012356789") {
    BAOZI.push(digit.repeat(len));
  }
}

/**
 * {3-6位顺子}：18 条。仅数字、仅升序，且跳过所有跨越 4 的段
 * （3 位有 123/234/345/567/678/789，没有 456）。
 */
const SHUNZI = [
  "123", "234", "345", "567", "678", "789",
  "1234", "2345", "3456", "5678", "6789",
  "12345", "23456", "34567", "56789",
  "123456", "234567", "345678",
];

/**
 * CVCV：辅音字母-元音字母 交替的四字组合，21×5×21×5 = 11025。
 *
 * 本项目扩展，原客户端没有此标签。这里的「辅音/元音」指字母而非拼音声韵母，
 * 所以用的是 21 个辅音字母（含 v）而不是上面的 SHENGMU。
 */
const CV_CONSONANTS = "bcdfghjklmnpqrstvwxyz".split("");
const CV_VOWELS = "aeiou".split("");

/**
 * 旧 `+` 号语法用的辅音字母集，与 CV_CONSONANTS 同值但语义独立：
 * 兼容层必须冻结旧行为，不能跟随 SHENGMU 的口径修正而改变已存规则的产出。
 */
const LEGACY_CONSONANTS = CV_CONSONANTS;

function cvcv(): string[] {
  const out: string[] = [];
  for (const c1 of CV_CONSONANTS)
    for (const v1 of CV_VOWELS)
      for (const c2 of CV_CONSONANTS)
        for (const v2 of CV_VOWELS) out.push(c1 + v1 + c2 + v2);
  return out;
}

/**
 * 双拼：两个完整音节连写，400² = 16 万条。
 *
 * 全量建数组约 20ms，但 TOKEN_CACHE 只建一次并永久缓存，因此不做截断 ——
 * 截断会让组合数预估显示成截断值而非真实值，预估就失去意义了。
 * 真正的规模约束在生成侧的 MAX_PREFIXES 与扫描侧的限频。
 */
function shuangpin(): string[] {
  return [...shuangpinIter()];
}

/**
 * 内置标签 → 候选串集合
 *
 * 标签名与西部数码客户端保持一致（{3-4位拼音} 而非 {3-4位拼}）—— 界面按钮上的
 * 文字是省略写法，真正参与解析的是这里的全名。
 *
 * 惰性求值 + 缓存：CVCV（11025）与双拼（16.8 万）建数组有成本，只在规则用到时才算。
 */
const TOKEN_CACHE = new Map<string, string[]>();

const TOKEN_BUILDERS: Record<string, () => string[]> = {
  字母: () => LETTERS,
  数字: () => DIGITS,
  数字无04: () => DIGITS_NO_04,
  声母: () => SHENGMU,
  韵母: () => YUNMU,

  "2位拼音": () => PINYIN_2,
  "3-4位拼音": () => PINYIN_34,
  "5-6位拼音": () => PINYIN_56,
  // {拼音} = 2位 + 3-4位 + 5-6位 三段拼接（原实现即如此，非独立全表）
  拼音: () => PINYIN_SYLLABLES,

  常见单词: () => COMMON_WORDS,
  名词: () => NOUNS,
  动词: () => VERBS,
  形容词: () => ADJECTIVES,

  "2-15位豹子": () => BAOZI,
  "3-6位顺子": () => SHUNZI,

  城市: () => CITY_PINYIN,
  城市简写: () => CITY_ABBR,
  省份简写: () => PROVINCE_ABBR,
  区号: () => AREA_CODES,
  // zipcodes.ts 照搬源码生成，不手工维护
  邮编: () => ZIP_CODES,

  // ── 以下为本项目扩展，原客户端没有 ──
  双拼: shuangpin,
  CVCV: cvcv,
};

/**
 * 旧标签名 → 现标签名。
 *
 * 上一版本用的是截图上的省略写法，已写进用户规则框和 localStorage，
 * 这里做静默映射，避免升级后旧规则报「标签无法识别」。
 */
const TOKEN_ALIASES: Record<string, string> = {
  "3-4位拼": "3-4位拼音",
  "5-6位拼": "5-6位拼音",
  汉字拼音: "拼音",
};

/** 全部内置标签名（供 UI 渲染快捷标签按钮，顺序即展示顺序） */
export const BUILTIN_TOKENS = Object.keys(TOKEN_BUILDERS);

/** 旧 `+` 号语法只支持这几个标签，用于判断一条无花括号的规则是否属于旧写法 */
const LEGACY_TOKENS = [
  "字母", "数字无04", "数字", "声母", "韵母",
  "2位拼音", "双拼", "2位豹子", "3位豹子", "CVCV",
];

/** 取内置标签的候选集（带缓存，支持旧名别名）；非内置标签返回 null */
function builtinToken(name: string): string[] | null {
  const key = TOKEN_BUILDERS[name] ? name : TOKEN_ALIASES[name];
  if (!key || !TOKEN_BUILDERS[key]) return null;
  let cached = TOKEN_CACHE.get(key);
  if (!cached) {
    cached = TOKEN_BUILDERS[key]();
    TOKEN_CACHE.set(key, cached);
  }
  return cached;
}

/** 一个槽位：candidates 为该位置的全部候选串 */
export interface Slot {
  /** 槽位来源标签名，字面量槽位为 null（仅用于报错提示） */
  token: string | null;
  candidates: string[];
}

/** 解析结果 */
export interface ParsedRule {
  slots: Slot[];
  /** 未能识别的标签名，UI 据此提示用户 */
  unknownTokens: string[];
  /** 逗号候选列表模式（无槽位组合，直接就是候选） */
  literalList: string[] | null;
}

/** 自定义词库解析器：由调用方注入，让 {词库名} 也能作为标签使用 */
export type BankResolver = (name: string) => string[] | null;

/**
 * 解析规则为槽位序列。
 *
 * @param rule       规则串
 * @param exclude    排除字符（逐槽位过滤，见下方说明）
 * @param legacyLen  旧 `+` 号语法下的长度下拉框值；花括号语法忽略此参数
 * @param resolveBank 自定义词库解析器
 */
export function parseRule(
  rule: string,
  exclude: string,
  legacyLen: number,
  resolveBank?: BankResolver
): ParsedRule {
  const trimmed = (rule || "").trim();
  const empty: ParsedRule = { slots: [], unknownTokens: [], literalList: null };
  if (!trimmed) return empty;

  // 排除字符：先过滤各槽位内的候选串，再做笛卡尔积。
  // 这与「生成后过滤」结果等价（积集合中不含排除字符的元素 ≡ 各槽位不含排除字符的元素的积），
  // 但保留了干净的组合数计数与截断能力。
  const exSet = new Set((exclude || "").toLowerCase().split("").filter(Boolean));
  const keep = (list: string[]) =>
    exSet.size === 0 ? list : list.filter((s) => !s.split("").some((c) => exSet.has(c)));

  const unknownTokens: string[] = [];

  const resolveToken = (name: string): string[] | null => {
    const builtin = builtinToken(name);
    if (builtin) return builtin;
    const bank = resolveBank?.(name);
    if (bank && bank.length > 0) return bank;
    return null;
  };

  // ── 语法 1：花括号 ──
  if (trimmed.includes("{")) {
    const slots: Slot[] = [];
    // 依次吃掉 {标签} 与其间的字面量
    const re = /\{([^{}]*)\}|([^{}]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      const [, tokenName, literal] = match;
      if (tokenName !== undefined) {
        const name = tokenName.trim();
        if (!name) continue;
        const candidates = resolveToken(name);
        if (!candidates) {
          unknownTokens.push(name);
          continue;
        }
        slots.push({ token: name, candidates: keep(candidates) });
      } else if (literal !== undefined) {
        const lit = literal.trim().toLowerCase();
        if (lit) slots.push({ token: null, candidates: keep([lit]) });
      }
    }
    return { slots, unknownTokens, literalList: null };
  }

  // ── 语法 2：旧 `+` 号 ──
  const hasLegacyToken = LEGACY_TOKENS.some((t) => trimmed.includes(t));
  if (hasLegacyToken) {
    const slots = parseLegacy(trimmed, keep, legacyLen);
    return { slots, unknownTokens, literalList: null };
  }

  // ── 语法 3：逗号候选列表 ──
  const list = Array.from(
    new Set(
      keep(
        trimmed
          .toLowerCase()
          .split(/[+,;，；\s\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  );
  return { slots: [], unknownTokens, literalList: list };
}

/**
 * 旧 `+` 号语法：`声母+韵母` → 两个槽位；单标签 + 长度下拉框 → 重复该槽位 N 次。
 * 旧的整体型标签（2位拼音/双拼/豹子/CVCV）映射到新标签，语义保持不变。
 */
function parseLegacy(
  rule: string,
  keep: (l: string[]) => string[],
  legacyLen: number
): Slot[] {
  // 整体型标签：旧实现下它们直接返回全部候选，等价于单槽位且不受长度下拉框影响
  const whole: Record<string, string> = {
    CVCV: "CVCV",
    "3位豹子": "2-6位豹子",
    "2位豹子": "2-6位豹子",
    双拼: "2位拼音",     // 旧语义下 双拼 == 2位拼音（声母+韵母），保持兼容
    "2位拼音": "2位拼音",
  };
  for (const [oldName, newName] of Object.entries(whole)) {
    if (!rule.includes(oldName)) continue;
    if (oldName === "2位豹子" || oldName === "3位豹子") {
      // 旧语义：字母与数字的等长重复串，含 44/aa，与新 {2-15位豹子} 的纯数字口径不同
      const n = oldName === "2位豹子" ? 2 : 3;
      const rep = [...LETTERS, ...DIGITS].map((ch) => ch.repeat(n));
      return [{ token: oldName, candidates: keep(rep) }];
    }
    if (oldName === "双拼" || oldName === "2位拼音") {
      // 旧语义：辅音字母 × 元音字母 两字母组合（105 个），不是真实音节表
      const cv: string[] = [];
      for (const c of LEGACY_CONSONANTS) for (const v of CV_VOWELS) cv.push(c + v);
      return [{ token: oldName, candidates: keep(cv) }];
    }
    return [{ token: oldName, candidates: keep(builtinToken(newName) || []) }];
  }

  const classMap: Record<string, string[]> = {
    字母: LETTERS,
    数字无04: DIGITS_NO_04,
    数字: DIGITS,
    声母: LEGACY_CONSONANTS,
    韵母: CV_VOWELS,
  };

  let pools: string[][] = [];
  for (const seg of rule.split("+").map((s) => s.trim()).filter(Boolean)) {
    if (classMap[seg]) {
      pools.push(classMap[seg]);
      continue;
    }
    // 兼容未用 + 分隔的连写（如 "字母数字"），数字无04 优先于 数字
    if (seg.includes("数字无04")) pools.push(classMap["数字无04"]);
    else if (seg.includes("数字")) pools.push(classMap["数字"]);
    else if (seg.includes("字母")) pools.push(classMap["字母"]);
    else if (seg.includes("声母")) pools.push(classMap["声母"]);
    else if (seg.includes("韵母")) pools.push(classMap["韵母"]);
  }

  // 仅识别到单个位置时，用长度下拉框把该位置重复 N 次（如 "字母" + 3 位 → aaa..zzz）
  if (pools.length === 1 && legacyLen > 1) pools = Array(legacyLen).fill(pools[0]);

  return pools.map((p) => ({ token: null, candidates: keep(p) }));
}

/**
 * 组合总数 —— 各槽位大小相乘，不生成任何字符串。
 * 任一槽位被排除字符清空则返回 0。
 */
export function countCombos(parsed: ParsedRule): number {
  if (parsed.literalList) return parsed.literalList.length;
  if (parsed.slots.length === 0) return 0;
  let total = 1;
  for (const s of parsed.slots) {
    if (s.candidates.length === 0) return 0;
    total *= s.candidates.length;
  }
  return total;
}

/**
 * 按下标映射生成第 i 条组合。
 * 下标映射（而非嵌套循环）保证任意截断点都产出完整长度的结果。
 */
function comboAt(slots: Slot[], index: number): string {
  let idx = index;
  let s = "";
  for (let p = slots.length - 1; p >= 0; p--) {
    const pool = slots[p].candidates;
    s = pool[idx % pool.length] + s;
    idx = Math.floor(idx / pool.length);
  }
  return s;
}

/** 生成前 limit 条组合（惰性：只算需要的那些，不建全量数组） */
export function generateCombos(parsed: ParsedRule, limit: number): string[] {
  if (parsed.literalList) return parsed.literalList.slice(0, limit);
  const total = countCombos(parsed);
  if (total === 0) return [];
  const n = Math.min(total, limit);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(comboAt(parsed.slots, i));
  return Array.from(new Set(out));
}

/** 一步到位：解析 + 生成，供扫描入口调用 */
export function generatePrefixes(
  rule: string,
  exclude: string,
  legacyLen: number,
  limit: number,
  resolveBank?: BankResolver
): string[] {
  return generateCombos(parseRule(rule, exclude, legacyLen, resolveBank), limit);
}
