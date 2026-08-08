/**
 * 批量查重前缀词库
 *
 * 纯静态数据，零依赖。中文词条在提交查询前会由 punycode.ts 的 toASCII() 统一转为
 * xn-- 形式，日志与界面展示仍保留中文原文。
 */

/** 中文分类词库 —— 按语义主题分组 */
export const CN_WORDBANKS: Record<string, string[]> = {
  地名城市: [
    "北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "重庆",
    "武汉", "西安", "苏州", "天津", "长沙", "青岛", "厦门", "宁波",
    "无锡", "大连", "沈阳", "昆明", "合肥", "济南", "福州", "郑州",
    "东莞", "佛山", "珠海", "海口", "三亚", "拉萨", "香港", "澳门",
  ],
  明星名人: [
    "周杰伦", "刘德华", "张学友", "王菲", "邓紫棋", "林俊杰", "陈奕迅",
    "李荣浩", "薛之谦", "毛不易", "华晨宇", "张艺兴", "易烊千玺",
    "成龙", "李连杰", "甄子丹", "巩俐", "章子怡", "汤唯", "周迅",
    "梁朝伟", "刘亦菲", "杨幂", "赵丽颖", "迪丽热巴", "胡歌",
  ],
  网站App: [
    "微博", "抖音", "淘宝", "京东", "支付宝", "微信", "知乎", "豆瓣",
    "哔哩哔哩", "小红书", "美团", "饿了么", "拼多多", "闲鱼", "网易",
    "腾讯", "阿里", "百度", "高德", "滴滴", "携程", "去哪儿", "keep",
    "钉钉", "飞书", "语雀", "掘金", "简书", "起点", "晋江",
  ],
  游戏角色: [
    "李白", "貂蝉", "韩信", "露娜", "赵云", "孙悟空", "妲己", "鲁班",
    "安琪拉", "花木兰", "诸葛亮", "甄姬", "虞姬", "蔡文姬", "程咬金",
    "亚瑟", "达摩", "钟馗", "武则天", "王昭君", "上官婉儿", "公孙离",
    "马可波罗", "后羿", "小乔", "大乔", "周瑜", "扁鹊", "庄周",
  ],
  吃喝玩乐: [
    "火锅", "烧烤", "奶茶", "咖啡", "串串", "麻辣烫", "螺蛳粉", "小龙虾",
    "寿司", "拉面", "披萨", "汉堡", "炸鸡", "烤肉", "自助餐", "早茶",
    "甜品", "蛋糕", "面包", "冰淇淋", "果汁", "啤酒", "红酒", "威士忌",
    "旅行", "露营", "徒步", "滑雪", "冲浪", "潜水", "健身", "瑜伽",
  ],
  吉祥寓意: [
    "发财", "吉祥", "如意", "平安", "幸福", "快乐", "健康", "长寿",
    "招财", "进宝", "鸿运", "旺财", "兴隆", "顺利", "美满", "圆满",
    "富贵", "安康", "喜庆", "祥瑞", "福气", "好运", "大吉", "昌盛",
  ],
};

/** 英文词库 —— 按字母数分组 */
export const EN_WORDBANKS_BY_LENGTH: Record<number, string[]> = {
  4: [
    "star", "moon", "wind", "fire", "wave", "leaf", "rock", "gold",
    "blue", "pink", "gray", "dawn", "dusk", "rain", "snow", "mist",
    "bird", "fish", "bear", "wolf", "lion", "deer", "hawk", "swan",
    "code", "byte", "data", "link", "node", "sync", "flow", "grid",
    "fast", "bold", "cool", "warm", "soft", "pure", "wise", "calm",
    "beam", "aura", "echo", "iris", "jade", "onyx", "opal", "ruby",
  ],
  5: [
    "cloud", "storm", "flame", "ocean", "river", "stone", "amber", "ivory",
    "coral", "pearl", "topaz", "azure", "cyan", "lunar", "solar", "nova",
    "tiger", "eagle", "raven", "shark", "koala", "panda", "otter", "lemur",
    "pixel", "cache", "stack", "query", "token", "proxy", "cloud", "shard",
    "swift", "brave", "sharp", "quick", "clear", "fresh", "smart", "quiet",
    "orbit", "prism", "spark", "vivid", "zenit", "delta", "gamma", "sigma",
  ],
  6: [
    "shadow", "sunset", "meadow", "canyon", "island", "desert", "forest", "valley",
    "silver", "bronze", "copper", "marble", "indigo", "violet", "cherry", "orange",
    "falcon", "jaguar", "dragon", "phoenix", "walrus", "badger", "beetle", "cicada",
    "server", "socket", "buffer", "kernel", "module", "packet", "thread", "vector",
    "bright", "gentle", "steady", "nimble", "serene", "vibrant", "modern", "simple",
    "cosmic", "lucent", "zephyr", "aurora", "eclipse", "nebula", "quartz", "summit",
  ],
};

/** 英文词库 —— 按语义主题分组 */
export const EN_WORDBANKS_THEMED: Record<string, string[]> = {
  水果: [
    "apple", "mango", "peach", "grape", "lemon", "melon", "berry", "plum",
    "cherry", "orange", "banana", "papaya", "guava", "kiwi", "fig", "pear",
    "apricot", "lychee", "durian", "pomelo", "coconut", "avocado",
  ],
  国家: [
    "japan", "china", "korea", "france", "spain", "italy", "brazil", "chile",
    "egypt", "india", "kenya", "malta", "nepal", "peru", "qatar", "sweden",
    "norway", "canada", "mexico", "greece", "turkey", "poland", "iceland",
  ],
  名人: [
    "tesla", "edison", "newton", "darwin", "curie", "turing", "hawking",
    "einstein", "galileo", "kepler", "faraday", "pascal", "euler", "gauss",
    "mozart", "chopin", "monet", "picasso", "dali", "kafka", "orwell",
  ],
  品牌: [
    "apple", "nike", "adidas", "sony", "canon", "nikon", "bose", "dyson",
    "lego", "ikea", "uniqlo", "muji", "zara", "gucci", "prada", "rolex",
    "tesla", "toyota", "honda", "mazda", "volvo", "audi", "bmw",
  ],
  特殊含义: [
    "zen", "aura", "flux", "apex", "nexus", "vertex", "matrix", "cipher",
    "quantum", "photon", "neutron", "proton", "atlas", "titan", "hydra",
    "oracle", "phantom", "mirage", "legacy", "genesis", "infinity", "eternal",
    "alpha", "omega", "prime", "ultra", "hyper", "mega", "micro", "nano",
  ],
};


/** 中文词库分类名列表（供 UI 渲染标签） */
export const CN_CATEGORIES = Object.keys(CN_WORDBANKS);

/** 英文主题分类名列表（供 UI 渲染标签） */
export const EN_THEMED_CATEGORIES = Object.keys(EN_WORDBANKS_THEMED);

/** 英文可选字母长度（供 UI 渲染标签） */
export const EN_LENGTHS = Object.keys(EN_WORDBANKS_BY_LENGTH).map(Number);

/**
 * 按分类名取词库内容。支持三种来源：
 * - 中文分类名（如「地名城市」）
 * - 英文主题名（如「水果」）
 * - 英文字母数（如 4 / 5 / 6）
 */
export function getWordbank(category: string): string[] {
  if (CN_WORDBANKS[category]) return CN_WORDBANKS[category];
  if (EN_WORDBANKS_THEMED[category]) return EN_WORDBANKS_THEMED[category];
  const asLen = Number(category);
  if (!Number.isNaN(asLen) && EN_WORDBANKS_BY_LENGTH[asLen]) {
    return EN_WORDBANKS_BY_LENGTH[asLen];
  }
  return [];
}

// ===========================================================================
// 可编辑词库模型
//
// 上面的常量为「内置默认词库」，仅在首次使用（localStorage 为空）时作为种子导入。
// 之后用户对分组的增删改都保存在 localStorage，内置常量不再参与运算。
// ===========================================================================

/** 词库分组的类型：中文 / 英文按字母数 / 英文按主题 */
export type BankKind = "cn" | "en-length" | "en-themed";

/** 一个可编辑的词库分组 */
export interface WordBank {
  /** 稳定唯一 ID（重命名不影响引用） */
  id: string;
  /** 分组类型，决定在 UI 中归属哪一栏 */
  kind: BankKind;
  /** 分组显示名称 */
  name: string;
  /** 词条列表 */
  words: string[];
  /** 是否由内置种子导入（仅用于 UI 标识，内置分组同样可编辑/删除） */
  builtin?: boolean;
}

/** localStorage 存储键 */
export const WORDBANK_STORAGE_KEY = "DNSHE_WORDBANKS";

/**
 * 分组类型的中文标签与配色（供 UI 渲染）
 *
 * 注意：Tailwind 需要完整类名才能在构建时保留，因此这里写死完整 class 字符串，
 * 不能改成 `text-${accent}-400` 这类动态拼接。
 */
export const BANK_KIND_META: Record<
  BankKind,
  { label: string; titleClass: string; hoverBorderClass: string; hoverTextClass: string }
> = {
  cn: {
    label: "中文词库",
    titleClass: "text-emerald-400",
    hoverBorderClass: "hover:border-emerald-500/40",
    hoverTextClass: "group-hover:text-emerald-300",
  },
  "en-length": {
    label: "英文词库 · 按字母数",
    titleClass: "text-sky-400",
    hoverBorderClass: "hover:border-sky-500/40",
    hoverTextClass: "group-hover:text-sky-300",
  },
  "en-themed": {
    label: "英文词库 · 按主题",
    titleClass: "text-amber-400",
    hoverBorderClass: "hover:border-amber-500/40",
    hoverTextClass: "group-hover:text-amber-300",
  },
};

/** 生成一个稳定的分组 ID */
export function makeBankId(): string {
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 把内置常量摊平为可编辑分组列表（仅首次使用时作为种子） */
export function buildDefaultBanks(): WordBank[] {
  const banks: WordBank[] = [];

  for (const [name, words] of Object.entries(CN_WORDBANKS)) {
    banks.push({ id: makeBankId(), kind: "cn", name, words: [...words], builtin: true });
  }
  for (const [len, words] of Object.entries(EN_WORDBANKS_BY_LENGTH)) {
    banks.push({
      id: makeBankId(),
      kind: "en-length",
      name: `${len} 字母单词`,
      words: [...words],
      builtin: true,
    });
  }
  for (const [name, words] of Object.entries(EN_WORDBANKS_THEMED)) {
    banks.push({ id: makeBankId(), kind: "en-themed", name, words: [...words], builtin: true });
  }

  return banks;
}

/**
 * 记录「已经播过种的内置分组名」。
 *
 * 用途：老用户的 localStorage 里只有旧版内置分组，新增分组不会自动出现。补种时若简单地
 * 「补全所有缺失的内置组」，会把用户手动删掉的组也一起复活 —— 所以这里单独记账，
 * 只补从未播种过的组名，用户删过的组不再回来。
 */
const SEEDED_KEY = "DNSHE_WORDBANKS_SEEDED";

function loadSeeded(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeeded(names: Set<string>): void {
  try {
    localStorage.setItem(SEEDED_KEY, JSON.stringify([...names]));
  } catch {
    /* 配额溢出等情况忽略：补种失败只是少几个默认分组，不影响使用 */
  }
}

/**
 * 从 localStorage 读取词库；为空或损坏时回落到内置种子。
 *
 * 同时做增量补种：把「从未播种过」的内置分组补进来，让老用户也能拿到新增的词性分组，
 * 且不会复活用户手动删除的分组（见 SEEDED_KEY 说明）。
 *
 * @param reservedNames 内置标签名集合，与之同名的旧词库会被清理（由调用方传入以避免循环依赖）
 */
export function loadWordBanks(reservedNames?: Set<string>): WordBank[] {
  const defaults = buildDefaultBanks();

  let existing: WordBank[] | null = null;
  try {
    const raw = localStorage.getItem(WORDBANK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 基本形状校验，过滤掉损坏项
        existing = parsed.filter(
          (b: unknown): b is WordBank =>
            !!b &&
            typeof (b as WordBank).id === "string" &&
            typeof (b as WordBank).name === "string" &&
            Array.isArray((b as WordBank).words)
        );
      }
    }
  } catch {
    existing = null;
  }

  // 首次使用：全量播种，并记账
  if (!existing || existing.length === 0) {
    saveSeeded(new Set(defaults.map((b) => b.name)));
    return defaults;
  }

  // 剔除与内置标签同名的旧词库。
  // 这类分组来自早期版本（那时 邮编/名词/动词 等还不是内置标签），如今解析 {名称}
  // 时内置定义优先，它们永远取不到，留在界面上只会让人以为点了有用。
  if (reservedNames && reservedNames.size > 0) {
    const kept = existing.filter((b) => !reservedNames.has(b.name));
    if (kept.length !== existing.length) {
      existing = kept;
      saveWordBanks(existing);
    }
  }

  // 老用户：补入从未播种过的内置分组
  const seeded = loadSeeded();
  const present = new Set(existing.map((b) => b.name));
  const toAdd = defaults.filter((b) => !seeded.has(b.name) && !present.has(b.name));

  if (toAdd.length > 0) {
    const merged = [...existing, ...toAdd];
    saveWordBanks(merged);
    saveSeeded(new Set([...seeded, ...defaults.map((b) => b.name)]));
    return merged;
  }

  // 首次运行本版本但分组已齐全时，也要把记账补上，避免下次重复判断
  if (seeded.size === 0) saveSeeded(new Set([...present, ...defaults.map((b) => b.name)]));

  return existing;
}

/** 保存词库到 localStorage */
export function saveWordBanks(banks: WordBank[]): void {
  try {
    localStorage.setItem(WORDBANK_STORAGE_KEY, JSON.stringify(banks));
  } catch (e) {
    console.error("保存词库失败:", e);
  }
}

/** 把逗号/空格/换行分隔的文本解析为去重后的词条数组 */
export function parseWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,，;；\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}
