/**
 * 规则数据校验 + 邮编生成脚本
 *
 * 用法（在 frontend 目录下）：
 *   node scripts/verify-rules.mjs
 *
 * 做两件事：
 *   1. 把 Words.cs 里的 value5（邮编，3173 条）提取出来，生成 src/zipcodes.ts。
 *      这份数据量太大，手工转录无法保证准确，必须由脚本生成。
 *   2. 逐条比对手工转录的各张表与 Words.cs 源码，报告差异。
 *      我转录了几千条词表，这一步是查我自己有没有抄错。
 *
 * 全程只写 src/zipcodes.ts 一个文件，其余均为只读检查。
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const WORDS_CS = "D:/DBB1S/_unpack/src/West263Domain/Words.cs";

let failures = 0;
let warnings = 0;

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function head(title) {
  console.log(`\n${c.cyan("=".repeat(64))}`);
  console.log(c.cyan(`  ${title}`));
  console.log(c.cyan("=".repeat(64)));
}

function pass(label, detail = "") {
  console.log(`  ${c.green("PASS")}  ${label}${detail ? "  " + c.dim(detail) : ""}`);
}

function fail(label, detail = "") {
  failures++;
  console.log(`  ${c.red("FAIL")}  ${label}${detail ? "  " + detail : ""}`);
}

function warn(label, detail = "") {
  warnings++;
  console.log(`  ${c.yellow("WARN")}  ${label}${detail ? "  " + c.dim(detail) : ""}`);
}

// ───────────────────────────────────────────────────────────────
// 从 Words.cs 抽取 C# 字符串数组
// ───────────────────────────────────────────────────────────────

if (!existsSync(WORDS_CS)) {
  console.error(c.red(`找不到反编译源码：${WORDS_CS}`));
  console.error("如果路径变了，改本脚本顶部的 WORDS_CS 常量。");
  process.exit(1);
}

const csSrc = readFileSync(WORDS_CS, "utf8");

/**
 * 按变量名抽取形如 `string[] value5 = new string[3173] { "a", "b", ... };` 的数组。
 * 返回 { declared, items }：declared 是源码声明的长度，items 是实际解析出的元素。
 * 两者不一致说明脚本解析有问题，会直接报错退出。
 */
function extractCsArray(varName) {
  const re = new RegExp(
    `string\\[\\]\\s+${varName}\\s*=\\s*new\\s+string\\[(\\d+)\\]\\s*\\{`,
    "m"
  );
  const m = re.exec(csSrc);
  if (!m) throw new Error(`Words.cs 里找不到数组 ${varName}`);

  const declared = Number(m[1]);
  const start = m.index + m[0].length;
  const end = csSrc.indexOf("};", start);
  if (end === -1) throw new Error(`数组 ${varName} 没有找到结束的 };`);

  const body = csSrc.slice(start, end);
  const items = [...body.matchAll(/"([^"]*)"/g)].map((x) => x[1]);

  if (items.length !== declared) {
    throw new Error(
      `数组 ${varName} 解析异常：声明 ${declared} 条，解析出 ${items.length} 条`
    );
  }
  return { declared, items };
}

// ───────────────────────────────────────────────────────────────
// 第 1 步：生成 zipcodes.ts
// ───────────────────────────────────────────────────────────────

head("第 1 步 · 生成 src/zipcodes.ts（{邮编}）");

const zip = extractCsArray("value5");
const zipUniq = [...new Set(zip.items)];

console.log(`  源码 value5 声明 ${zip.declared} 条，解析 ${zip.items.length} 条`);
console.log(`  去重后 ${zipUniq.length} 条（重复 ${zip.items.length - zipUniq.length} 条）`);

// 邮编长度分布：源码里 5 位与 6 位并存（河北/山西等地的邮编本就是 5 位），
// 因此只校验「全为纯数字」，不校验固定位数。
const nonNumeric = zipUniq.filter((z) => !/^\d+$/.test(z));
if (nonNumeric.length > 0) {
  fail(`发现 ${nonNumeric.length} 条非纯数字的邮编`, nonNumeric.slice(0, 10).join(", "));
} else {
  const byLen = {};
  for (const z of zipUniq) byLen[z.length] = (byLen[z.length] ?? 0) + 1;
  const dist = Object.keys(byLen)
    .sort()
    .map((k) => `${k}位 ${byLen[k]} 条`)
    .join("，");
  pass("全部为纯数字", dist);
}

const lines = [];
for (let i = 0; i < zipUniq.length; i += 10) {
  lines.push("  " + zipUniq.slice(i, i + 10).map((z) => `"${z}",`).join(" "));
}

const zipTs = `/**
 * {邮编} 全国邮政编码
 *
 * 本文件由 scripts/verify-rules.mjs 从西部数码客户端 Words.DomainWords() 的
 * value5 直接提取生成，未经手工转录，与源码逐条一致。请勿手改 —— 重新生成即可。
 *
 * 源码 ${zip.items.length} 条，按首次出现顺序去重后 ${zipUniq.length} 条。
 * （原表同一邮编多次出现，重复项在笛卡尔积中不产生新组合，只会让组合数预估虚高。）
 */

export const ZIP_CODES: string[] = [
${lines.join("\n")}
];
`;

const zipPath = join(FRONTEND, "src", "zipcodes.ts");
writeFileSync(zipPath, zipTs, "utf8");
pass("已写入 src/zipcodes.ts", `${zipUniq.length} 条`);

// ───────────────────────────────────────────────────────────────
// 第 2 步：校验手工转录的表
// ───────────────────────────────────────────────────────────────

head("第 2 步 · 校验手工转录的数据表");

// 用 esbuild 把 TS 转成可 import 的 ESM，避免依赖 ts-node。
// 走 JS API 而不是命令行：Windows 上 node_modules/.bin/esbuild.cmd 是 batch 文件，
// execFileSync 无法直接执行（需要 shell 解释），JS API 没有这个问题。
let esbuild;
try {
  esbuild = await import("esbuild");
} catch {
  console.error(c.red("  找不到 esbuild，请先在 frontend 目录跑 npm install"));
  process.exit(1);
}

const bundlePath = join(FRONTEND, ".verify-bundle.mjs");
try {
  await esbuild.build({
    entryPoints: [join(FRONTEND, "src", "rulegen.ts")],
    bundle: true,
    format: "esm",
    outfile: bundlePath,
    logLevel: "silent",
    absWorkingDir: FRONTEND,
  });
} catch (e) {
  console.error(c.red("\n  esbuild 打包 src/rulegen.ts 失败："));
  for (const err of e.errors ?? []) {
    const loc = err.location;
    console.error(
      `    ${loc ? `${loc.file}:${loc.line}:${loc.column}` : "(无位置)"}  ${err.text}`
    );
    if (loc?.lineText) console.error(`      ${c.dim(loc.lineText.trim())}`);
  }
  if (!e.errors?.length) console.error(`    ${e.message ?? e}`);
  console.error("\n  数据表校验无法继续；src/zipcodes.ts 已生成，修掉上面的报错后重跑本脚本。");
  process.exit(1);
}

const rg = await import(`file://${bundlePath.replace(/\\/g, "/")}?t=${Date.now()}`);

/** 取某个标签的候选集 */
const tokenOf = (name) => {
  const parsed = rg.parseRule(`{${name}}`, "", 2);
  if (parsed.unknownTokens.length > 0) return null;
  return parsed.slots[0]?.candidates ?? null;
};

/**
 * 比对一个标签与源码数组。
 * expectAdded / expectRemoved 是「照搬但修缺陷」口径下预期的增删项，
 * 出现在预期内的差异算 PASS，预期外的差异算 FAIL。
 */
function checkToken(token, csVar, { expectAdded = [], expectRemoved = [], dedupe = false } = {}) {
  const mine = tokenOf(token);
  if (mine === null) {
    fail(`{${token}}`, "标签无法识别（未接入或改名了？）");
    return;
  }

  const src = extractCsArray(csVar).items;
  const srcSet = new Set(dedupe ? [...new Set(src)] : src);
  const mineSet = new Set(mine);

  const added = mine.filter((x) => !srcSet.has(x));
  const removed = [...srcSet].filter((x) => !mineSet.has(x));

  const unexpectedAdd = added.filter((x) => !expectAdded.includes(x));
  const unexpectedDel = removed.filter((x) => !expectRemoved.includes(x));

  const label = `{${token}}`.padEnd(14);
  const counts = `我 ${mine.length} / 源码 ${src.length}${dedupe ? ` (去重 ${srcSet.size})` : ""}`;

  if (unexpectedAdd.length === 0 && unexpectedDel.length === 0) {
    const note = [];
    if (added.length) note.push(`已按预期补入 ${added.length} 条: ${added.join(",")}`);
    if (removed.length) note.push(`已按预期剔除 ${removed.length} 条: ${removed.join(",")}`);
    pass(label, [counts, ...note].join(" · "));
  } else {
    fail(label, counts);
    if (unexpectedAdd.length)
      console.log(`         ${c.red("多出（源码没有）")}: ${unexpectedAdd.slice(0, 20).join(", ")}${unexpectedAdd.length > 20 ? ` …共 ${unexpectedAdd.length} 条` : ""}`);
    if (unexpectedDel.length)
      console.log(`         ${c.red("漏掉（源码有）")}: ${unexpectedDel.slice(0, 20).join(", ")}${unexpectedDel.length > 20 ? ` …共 ${unexpectedDel.length} 条` : ""}`);
  }

  const dup = mine.length - mineSet.size;
  if (dup > 0) warn(`  ${label} 自身有 ${dup} 条重复`);
}

console.log(c.dim("  预期内的增删来自「照搬但修缺陷」口径，会标注出来；预期外的差异即为转录错误\n"));

// 拼音三表
checkToken("2位拼音", "array", { expectAdded: ["ma", "ni", "ga", "ha", "me"] });
checkToken("3-4位拼音", "array2", { expectRemoved: ["fiao", "nun"] });
checkToken("5-6位拼音", "array3", { expectAdded: ["chuan"] });

// 字符集与整体型标签（应与源码完全一致，无增删）
checkToken("字母", "value8");
checkToken("数字", "value9");
checkToken("数字无04", "value16");
checkToken("声母", "value10");
checkToken("韵母", "value11");
checkToken("2-6位豹子", "value14");
checkToken("3-6位顺子", "value15");
checkToken("省份简写", "value13");

// 英文词表
checkToken("动词", "value2");
checkToken("名词", "value3");
checkToken("形容词", "value4");

// 这两张表转录时做了归一，用 dedupe 比对去重后的集合
checkToken("城市", "value7", { dedupe: true });
checkToken("城市简写", "value12", { dedupe: true });

// {常见单词} 源码有大小写混排，需先小写化再比
{
  const mine = tokenOf("常见单词");
  const src = extractCsArray("value").items;
  const srcLower = [...new Set(src.map((s) => s.toLowerCase()))];
  const srcSet = new Set(srcLower);
  const mineSet = new Set(mine ?? []);
  const added = (mine ?? []).filter((x) => !srcSet.has(x));
  const removed = srcLower.filter((x) => !mineSet.has(x));
  const label = "{常见单词}".padEnd(14);
  const counts = `我 ${mine?.length ?? 0} / 源码 ${src.length}（小写去重后 ${srcLower.length}）`;
  if (!mine) fail(label, "标签无法识别");
  else if (added.length === 0 && removed.length === 0) pass(label, counts);
  else {
    fail(label, counts);
    if (added.length) console.log(`         ${c.red("多出")}: ${added.slice(0, 20).join(", ")}${added.length > 20 ? ` …共 ${added.length}` : ""}`);
    if (removed.length) console.log(`         ${c.red("漏掉")}: ${removed.slice(0, 20).join(", ")}${removed.length > 20 ? ` …共 ${removed.length}` : ""}`);
  }
}

// ───────────────────────────────────────────────────────────────
// 第 3 步：规则引擎行为
// ───────────────────────────────────────────────────────────────

head("第 3 步 · 规则引擎行为");

const count = (rule, exclude = "", len = 2) =>
  rg.countCombos(rg.parseRule(rule, exclude, len));

function expect(label, actual, want) {
  if (actual === want) pass(label, `= ${actual.toLocaleString()}`);
  else fail(label, `实际 ${actual?.toLocaleString?.() ?? actual}，期望 ${want.toLocaleString()}`);
}

const n = (name) => tokenOf(name)?.length ?? 0;

// 笛卡尔积
expect("{字母}×4 组合数", count("{字母}{字母}{字母}{字母}"), 26 ** 4);
expect("my{字母}{数字}", count("my{字母}{数字}"), 260);
expect("{声母}{韵母}", count("{声母}{韵母}"), n("声母") * n("韵母"));
expect("{3-4位拼音}{数字}", count("{3-4位拼音}{数字}"), n("3-4位拼音") * 10);

// 字面量混排的产出
{
  const got = rg.generateCombos(rg.parseRule("my{字母}{数字}", "", 2), 260);
  if (got[0] === "mya0" && got[got.length - 1] === "myz9") {
    pass("my{字母}{数字} 首末条", `${got[0]} … ${got[got.length - 1]}`);
  } else {
    fail("my{字母}{数字} 首末条", `实际 ${got[0]} … ${got[got.length - 1]}，期望 mya0 … myz9`);
  }
}

// 旧 + 号语法回归：改口径后旧规则的产出必须不变
expect("旧语法 声母+韵母", count("声母+韵母"), 105);
expect("旧语法 2位拼音", count("2位拼音"), 105);
expect("旧语法 字母（3位）", count("字母", "", 3), 26 ** 3);

// 旧标签名别名
expect("旧名 {3-4位拼}", count("{3-4位拼}"), n("3-4位拼音"));
expect("旧名 {5-6位拼}", count("{5-6位拼}"), n("5-6位拼音"));
expect("旧名 {汉字拼音}", count("{汉字拼音}"), n("拼音"));

// {拼音} = 三段拼接
expect("{拼音} 三段拼接", n("拼音"), n("2位拼音") + n("3-4位拼音") + n("5-6位拼音"));

// 逗号候选列表
expect("逗号列表 abc, def", count("abc, def"), 2);

// 排除字符：逐槽位过滤
expect("{字母}×4 排除 aeiou", count("{字母}{字母}{字母}{字母}", "aeiou"), 21 ** 4);
{
  const got = rg.generateCombos(rg.parseRule("{3-4位拼音}", "o", 2), 500);
  const withO = got.filter((s) => s.includes("o"));
  if (withO.length === 0) pass("排除 o 后无残留", `剩 ${got.length} 条`);
  else fail("排除 o 后仍有残留", withO.slice(0, 8).join(", "));
}

// 未知标签必须被报出来，而不是静默忽略
{
  const p = rg.parseRule("{这个标签不存在}", "", 2);
  if (p.unknownTokens.includes("这个标签不存在")) pass("未知标签会被报告");
  else fail("未知标签未被报告", JSON.stringify(p.unknownTokens));
}

// 邮编标签校验（zipcodes.ts 已在第 1 步生成并由 rulegen.ts 接入）
expect("{邮编}", n("邮编"), zipUniq.length);

// ───────────────────────────────────────────────────────────────

head("汇总");

console.log(`  失败 ${failures === 0 ? c.green("0") : c.red(String(failures))} 项，警告 ${warnings === 0 ? "0" : c.yellow(String(warnings))} 项`);

// 清掉打包临时产物
try {
  rmSync(bundlePath);
} catch {
  /* 删不掉不影响结果 */
}

console.log(c.dim("\n提示：本脚本只写 src/zipcodes.ts，其余均为只读检查。"));

process.exit(failures > 0 ? 1 : 0);
