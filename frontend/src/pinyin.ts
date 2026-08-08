/**
 * 普通话拼音音节表
 *
 * 数据来源：西部数码域名查询客户端 Words.DomainWords() 中的 array / array2 / array3
 * 三个数组，分别对应 {2位拼音} / {3-4位拼音} / {5-6位拼音}。
 *
 * 口径为「照搬源码 + 修正明确缺陷」：源码取值一律保留（包括 lue/nue 这类
 * 非 v 记法的写法），仅对下列确凿的数据缺陷做增删，每处都在行内标注。
 * 因此本表条数与客户端不同，但产出是它的严格超集减去非法音节。
 */

/**
 * {2位拼音} —— 源码 75 条 + 补 5 条常用音节。
 * 源码漏掉了 ma(妈) ni(你) ga ha me 这几个高频音节，属实缺陷，补回。
 */
export const PINYIN_2: string[] = [
  "ai", "an", "ba", "ca", "ce", "da", "de", "di", "ei", "en",
  "fa", "ge", "he", "ji", "ka", "ke", "la", "le", "li", "na",
  "ne", "pa", "pi", "qi", "re", "ri", "sa", "se", "ta", "te",
  "ti", "wa", "xi", "ya", "ye", "yi", "za", "ze", "ao", "bi",
  "bo", "bu", "ci", "cu", "du", "er", "fo", "fu", "gu", "hu",
  "ju", "ku", "lo", "lu", "lv", "mi", "mo", "mu", "nu", "nv",
  "ou", "po", "pu", "qu", "ru", "si", "su", "tu", "wo", "wu",
  "xu", "yo", "yu", "zi", "zu",
  // ↓ 源码缺失，补入
  "ma", "ni", "ga", "ha", "me",
];

/**
 * {3-4位拼音} —— 源码 295 条 − 剔除 2 条非法音节。
 * fiao 与 nun 不是普通话音节（fiao 仅见于个别方言拟声，nun 无对应汉字），剔除。
 */
export const PINYIN_34: string[] = [
  "bai", "ban", "bao", "bei", "ben", "cai", "can", "cao", "cen", "cha",
  "che", "chi", "dai", "dan", "dao", "dei", "den", "dia", "fan", "fei",
  "fen", "gai", "gan", "gao", "gei", "gen", "hai", "han", "hao", "hei",
  "hen", "jia", "jie", "jin", "kai", "kan", "kao", "kei", "ken", "lai",
  "lan", "lao", "lei", "lia", "mai", "man", "mao", "mei", "men", "nai",
  "nan", "nao", "nei", "nen", "pai", "pan", "pao", "pei", "pen", "qia",
  "qie", "qin", "ran", "rao", "ren", "sai", "san", "sao", "sen", "sha",
  "she", "shi", "tai", "tan", "tao", "wai", "wan", "wei", "xia", "xie",
  "xin", "yan", "yao", "yin", "zai", "zan", "zao", "zei", "zen", "zha",
  "zhe", "zhi", "ang", "bie", "bin", "chu", "cou", "cui", "cun", "cuo",
  "die", "diu", "dou", "dui", "dun", "duo", "eng", "fou", "gou", "gua",
  "gui", "gun", "guo", "hou", "hua", "hui", "hun", "huo", "jiu", "jue",
  "jun", "kou", "kua", "kui", "kun", "kuo", "lie", "lin", "liu", "lou",
  "lue", "lun", "luo", "mie", "min", "miu", "mou", "nie", "nin", "niu",
  "nou", "nue", "nuo", "pie", "pin", "pou", "qiu", "que", "qun",
  "rou", "rui", "run", "ruo", "shu", "sou", "sui", "sun", "suo", "tie",
  "tou", "tui", "tun", "tuo", "wen", "xiu", "xue", "xun", "you", "yue",
  "yun", "zhu", "zou", "zui", "zun", "zuo", "bang", "beng", "cang", "chai",
  "dang", "deng", "dian", "fang", "gang", "geng", "gong", "hang", "heng", "jian",
  "jiao", "kang", "keng", "kong", "lang", "lian", "liao", "mang", "meng", "nang",
  "neng", "nian", "pang", "peng", "qian", "qiao", "rang", "reng", "rong", "sang",
  "seng", "shai", "shan", "shao", "shei", "shen", "tang", "teng", "tian", "wang",
  "xian", "xiao", "yang", "ying", "zang", "zeng", "zhai", "zhan", "zhao", "zhei",
  "zhen", "bian", "biao", "bing", "chou", "chua", "chui", "chun", "chuo", "cong",
  "cuan", "diao", "ding", "dong", "duan", "feng", "guai", "guan", "hong",
  "huai", "huan", "jing", "juan", "kuai", "kuan", "ling", "long", "luan", "mian",
  "miao", "ming", "niao", "ning", "nong", "nuan", "pian", "piao", "ping", "qing",
  "quan", "ruan", "shou", "shua", "shui", "shun", "shuo", "song", "suan", "tiao",
  "ting", "tong", "tuan", "weng", "xing", "xuan", "yong", "yuan", "zhou", "zhua",
  "zhui", "zhun", "zhuo", "zong", "zuan",
];

/**
 * {5-6位拼音} —— 源码 26 条 + 补 chuan。
 * 源码列表里 chong 与 chuang 直接相邻，漏掉了 chuan(穿/船/川) 这个常用音节，补回。
 * 另一处相邻缺失 chuai(踹) 属冷僻字，跟随源码不补。
 */
export const PINYIN_56: string[] = [
  "chang", "cheng", "jiang", "liang", "niang", "qiang", "shang", "sheng", "xiang", "zhang",
  "zheng", "chong", "chuang", "guang", "huang", "jiong", "kuang", "qiong", "shuai", "shuan",
  "shuang", "xiong", "zhong", "zhuai", "zhuan", "zhuang",
  // ↓ 源码缺失，补入
  "chuan",
];

/**
 * {拼音} —— 三段拼接，与源码 array4 的构造方式一致（2位 + 3-4位 + 5-6位）。
 * 注意这不是「完整音节表」：源码本就不含单字母音节 a/e/o。
 */
export const PINYIN_SYLLABLES: string[] = [...PINYIN_2, ...PINYIN_34, ...PINYIN_56];

/**
 * 双拼：两个完整音节连写（taobao / jingdong / xiaomi）。
 *
 * 400² = 16 万条，一次性建数组会拖慢预览，因此用生成器惰性产出，
 * 调用方按需取用。本项目扩展，原客户端无此标签。
 */
export function* shuangpinIter(): Generator<string> {
  for (const a of PINYIN_SYLLABLES) {
    for (const b of PINYIN_SYLLABLES) {
      yield a + b;
    }
  }
}

/** 双拼的组合总数（供组合数预估用，无需真的生成） */
export const SHUANGPIN_COUNT = PINYIN_SYLLABLES.length * PINYIN_SYLLABLES.length;
