# 🌐 DNSHE 跨账号多域名自动化集中管理面板

[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Frontend-Cloudflare_Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare_D1_SQL-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一款专为 **DNSHE 免费域名用户** 设计的高颜值、现代化、全自动跨账号集中托管控制面板。

基于 **Cloudflare Serverless 全家桶**（Cloudflare Workers + Cloudflare Pages + Cloudflare D1）构建，无需采购服务器，即可完美免费托管于 Cloudflare 平台（支持 Serverless 零成本运行）。

---

## 📖 目录

- [🌟 核心功能特性](#-核心功能特性)
- [🏗️ 系统架构图解](#-系统架构图解)
- [🔑 环境变量与密钥说明（必看）](#-环境变量与密钥说明必看)
  - [1. GitHub Secrets（GitHub Actions 自动化部署必需）](#1-github-secretsgithub-actions-自动化部署必需)
  - [2. Cloudflare Worker 环境变量 / Secrets（后端运行期）](#2-cloudflare-worker-环境变量--secrets后端运行期)
  - [3. 前端编译环境变量](#3-前端编译环境变量)
- [🚀 详细部署流程](#-详细部署流程)
  - [准备工作：获取 Cloudflare 凭证](#准备工作获取-cloudflare-凭证)
  - [方式一：GitHub Actions 一键全自动部署 (推荐 ⭐⭐⭐⭐⭐)](#方式一github-actions-一键全自动部署-推荐-)
  - [方式二：Cloudflare CLI / Wrangler 手动部署](#方式二cloudflare-cli--wrangler-手动部署)
- [💻 本地二次开发与调试](#-本地二次开发与调试)
- [📁 项目目录结构](#-项目目录结构)
- [❓ 常见问题与注意事项 (FAQ)](#-常见问题与注意事项-faq)
- [📄 开源协议](#-开源协议)

---

## 🌟 核心功能特性

### 🔑 1. 跨账号集中管理
- 支持一次性绑定多个 DNSHE 账号（API Key + API Secret + 别名）。
- **别名智能解析**：别名可留空，系统自动调用 DNSHE 密钥列表接口获取该 Key 的名称作为别名，免手动录入。
- **批量绑定**：一次粘贴多组 `API Key + API Secret`（空格 / Tab / 逗号分隔，单次上限 50 个），逐条校验并自动解析别名。
- **绑定后自动三态分类**：绑定成功即自动深度同步域名（逐个拉取真实 DNS 解析记录），实时判定每个域名的【已委派 / 已解析 / 未解析】状态，并顺手将解析记录预热进本地缓存。
- **账号可修改**：已绑定账号支持随时修改别名或更换 API Key / Secret（换 Key 会校验新密钥有效性，并自动重新同步该账号的域名缓存）。
- **额度配额并发查询**：支持并发（`Promise.allSettled`）拉取所有绑定账号的免费域名注册配额使用情况，结果自动缓存，避免重复调用上游。

### 🏷️ 2. 域名三态智能识别
系统能自动侦测并识别域名的当前解析与配置状态：
- **`未解析`** ⚪ (灰色)：使用官方默认 NS（`ns1.dnshe.com` / `ns2.dnshe.com`），但尚未添加任何 DNS 解析记录。
- **`已解析`** 🟢 (绿色)：使用官方默认 NS，且已配置有效解析记录（支持在控制台进行全功能增删改查）。
- **`已委派`** 🔵 (蓝色)：已托管至第三方 NS（如 Cloudflare / DNSPod / NextDNS 等），下级 DNS 解析交由外部平台处理。

### 🛡️ 3. NS 域名服务器智能切换
- 支持在面板中一键添加自定义第三方 NS 记录（提供【强制替换冲突记录】能力）。
- 支持一键快捷恢复为 DNSHE 官方默认 NS 节点。
- **友好错误拦截**：若 DNSHE 上游平台禁用 NS 管理（`disable_ns_management`），后端能捕获并反馈清晰的中文指引。

### ⏳ 4. 终身无人值守自动续期
- 内置 Cloudflare Cron Trigger 触发器（默认每日 02:00 巡检）。
- **可自定义续期阈值**：可在设置中自定义提前续期天数（默认 180 天），剩余有效期低于阈值时自动触发免费续期 API。
- 自动更新本地数据库缓存并清理过期的系统日志。

### 🔔 5. 多渠道自动化消息通知
自动续期完成后，支持多渠道第一时间推送明细报告：
- **多平台 Webhook 适配**：内置适配 **钉钉 (DingTalk)**、**飞书 (Feishu)**、**企业微信 (WeCom)** 及 **自定义 (Custom)** 平台的 JSON 数据 Payload 结构。
- **Telegram Bot 原生推送**：支持独立配置 Telegram Bot Token 与 Chat ID，支持在控制台进行实时连通性测试。

### 🔐 6. 顶级安全防护体系
- **AES-GCM 加密**：敏感的 API Secret 和 2FA 密钥均采用 256 位 AES-GCM 高强度算法加密存储于 D1 数据库中。
- **PBKDF2 加盐密码**：管理员密码采用标准 PBKDF2 + Safe Random Salt 哈希防查表比对。
- **两步验证 (2FA / TOTP)**：支持绑定标准身份验证器（Google Authenticator / Microsoft Authenticator / Bitwarden），扫描 Base32 二维码完成 6 位动态口令验证。开启 2FA 后，登录页会**直接展示动态码输入框**（通过鉴权状态接口预判），无需先提交用户名密码。**关闭 2FA 时需输入当前 6 位动态码**完成安全校验（而非登录密码）。
- **应急逃生通道 (`ADMIN_TOKEN`)**：配置后可在忘记密码时，通过后门口令（静态 Token 或其 TOTP 动态码）安全恢复访问。

### 🔍 7. 在线 WHOIS 查询与一键注册
- 内置 WHOIS 代理查询功能，实时检测特定免费域名可注册状态。
- 支持直接在面板中一键提交新域名注册，注册成功后自动增量同步入库。

### 🈶 8. 中文域名 Punycode 全链路支持
- **直接输入中文注册**：二级前缀支持直接填写中文（如 `测试`），前后端统一在提交前转换为 `xn--` 形式的 ASCII 域名，符合 IDNA 规范。
- **零依赖实现**：内置一份纯 TypeScript 的 RFC 3492 Punycode 编解码器（`src/punycode.ts` / `frontend/src/punycode.ts`），Worker 与浏览器双端复用，不依赖 Node 内置 `punycode` 模块。
- **实时编码预览**：注册页输入中文时，下方即时显示将要提交的完整 Punycode 域名。
- **列表反解显示**：域名列表卡片自动把 `xn--0zwm56d.bbroot.com` 反解为 `测试.bbroot.com` 显示，**点击域名即一键复制**（复制的是 ASCII 原文，便于粘贴到 DNS 配置等场景）。
- **兼容中文句号**：输入 `。`／`．` 等全角句号会自动归一化为标准点号。

### 🧬 9. 批量查重引擎（规则生成 + 词库 + 顺序检测）
在「注册 / 查重」页提供两种模式：**精准单域名查重** 与 **规则多域名批量查重**。批量模式具备：
- **多账号并发流水线**：为每个已绑定账号开一条独立流水线，各自遵守 1.2s 限频，整体吞吐量约为单账号的 N 倍。
- **规则生成**：支持快捷标签（字母 / 数字 / 声母 / 韵母 / 双拼 / 豹子 / CVCV 等）逐位笛卡尔组合，可设置组合长度与排除字符，并有 2 万条组合爆炸保护上限。
- **可编辑词库**：内置中文（地名城市 / 明星名人 / 网站App / 游戏角色 / 吃喝玩乐 / 吉祥寓意）与英文（按 4/5/6 字母数分组、按水果 / 国家 / 名人 / 品牌 / 特殊含义分类）词库，全部支持**新增、编辑、删除分类与词条**，可随时「恢复默认」，修改持久化于浏览器本地。
- **顺序检测模式**：按字符集（纯字母 / 纯数字 / 字母+数字）进位递增顺序扫描（如 `qwe → qwf → … → qwz → qxa`），采用惰性生成避免超大字符空间撑爆内存。
- **断点续查**：暂停时自动保存进度光标（当前位置 / 已查数量 / 保存时间）至浏览器本地，下次进入页面会提示「从断点继续」或「清除断点」，无需从头重扫。
- **限流自动保护**：查询触发 HTTP 429 或配额上限时自动暂停并保住断点，避免持续撞限。
- **官方保留前缀排除**：预置 `ai` / `jd` / `qq` / `mail` 等官方不可注册前缀名单，查重前**整词匹配**剔除（`ai` 被排除但 `ailu` 仍会查询），名单支持增删、批量粘贴与一键恢复默认，单域名查重同样拦截。
- **一键清空规则**：规则框上方提供「一键清空」按钮，快速重置当前生成规则。
- **结果导出**：发现的可用域名可一键导出为 txt 字典文件，也可点击直接跳转注册。

### 🗂️ 10. 跨账号共享查重池（节省 API 配额）
- 查重确认为**已注册**的域名会写入后端 D1 查重池，后续批量扫描**先批量查池、命中即跳过**，不再重复消耗上游 API 配额。
- **跨账号 / 跨设备共享**：池子存于后端而非浏览器，多个账号与多台设备共用同一份结论。
- **7 天自动过期重验**：考虑到域名可能因他人续费释放或被主动删除而重新可注册，池中记录 7 天后自动失效并重新验证。
- **只缓存已注册**：未注册域名随时可能被抢注，因此不入池，避免给出过期的「可注册」结论。
- **强制重查开关**：可勾选「忽略查重池，强制全部重查」来主动刷新结论；池子查询失败时自动退化为全量扫描，不阻断流程。

### 🧊 11. 智能 API 缓存（防滥用保护）
为降低对 DNSHE 官方 API 的调用频率（避免被判定 API 滥用导致封号），系统内置 **「写操作回源、读操作命中缓存」** 的缓存机制：
- **读操作零调用**：查看账户配额、打开域名 DNS 解析面板等纯查询操作，默认**只命中 D1 本地缓存**，不再向 DNSHE 官方发起请求。
- **绑定即预热**：绑定 / 批量绑定 / 更换 Key 后的深度同步会逐个拉取真实 DNS 记录用于三态分类，并将这些记录**顺手回填本地缓存**，之后打开对应域名 DNS 面板直接命中缓存、零上游调用。
- **写操作自动回填**：增删改 DNS 记录、注册域名、手动续期等写操作成功后，系统会回源拉取最新数据并**自动回填缓存**，下次读取直接命中。
- **手动强制刷新**：配额页与 DNS 管理弹窗均提供「刷新」按钮（携带 `?refresh=1`），可一键绕过缓存强制回源并更新缓存，作为数据异常时的兜底手段。
- **过期兜底**：缓存写入 1 年后过期，避免长期占用 D1 存储空间（正常由写操作主动重填）。
- 注：由于缓存不主动过期，若在 **DNSHE 官网后台直接修改**了记录或配额，面板会显示旧数据，直到您在面板内执行一次写操作或点击「刷新」按钮。

### 🔔 12. 未读告警通知
- 顶部小铃铛实时汇总最近告警/错误日志，并带有**未读红点**。
- 打开铃铛下拉或点击「查看全部」即标记为已读、红点消失；有新告警产生时会再次亮起（已读状态持久化于浏览器本地）。

### 🎨 13. 人性化前端体验
- **页面记忆**：当前所在选项卡同步到 URL Hash，刷新页面、浏览器前进 / 后退、直接分享带 `#xxx` 的链接均可停留在原页面。
- **账号分组折叠**：域名列表按账号分组并自动编号（账号 1 / 账号 2 …），点击标题可展开或收起单个账号，筛选栏右侧提供「展开全部 / 收起全部」一键切换；**折叠状态自动记忆**，刷新或重进页面保持上次的展开/收起布局。
- **折叠式绑定面板**：账号管理页把「绑定单个 / 批量绑定」收纳为列表上方的两个按钮，点击才展开输入框，列表区保持清爽。
- **敏感配置收起**：设置页的后端 Worker 地址保存后自动收起为状态行（不再常驻显示完整地址），点击「修改」才会重新展开输入框。

---

## 🏗️ 系统架构图解

```text
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Pages (前端 UI)                  │
│       React 18 + TypeScript + Tailwind CSS + Lucide Icons   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP API / Bearer Session Token
┌──────────────────────────────▼──────────────────────────────┐
│                Cloudflare Workers (后端 API)                 │
│              Hono.js 框架 + Router + Security Auth           │
└──────┬───────────────────────┬──────────────────────┬───────┘
       │                       │                      │
┌──────▼───────┐       ┌───────▼────────┐     ┌───────▼───────┐
│ Cloudflare D1│       │ Cron Trigger   │     │ DNSHE Official│
│ SQL + 缓存    │       │ 每日 02:00 巡检 │     │ REST API V2.0 │
└──────────────┘       └────────────────┘     └───────────────┘
```

---

## 🔑 环境变量与密钥说明（必看）

为确保部署顺利以及数据安全，请仔细阅读以下环境变量的区分与定义：

### 1. GitHub Secrets（GitHub Actions 自动化部署必需）

在使用 GitHub Actions 进行自动构建发布时，需在 GitHub 仓库的 **Settings -> Secrets and variables -> Actions** 中配置：

| 变量名 | 是否必要 | 默认值 / 推荐值 | 作用与详细说明 |
| :--- | :---: | :--- | :--- |
| **`CLOUDFLARE_API_TOKEN`** | **必要 🔴** | 无 | Cloudflare API Token。需要在 Cloudflare 后台创建，至少具备 `Workers:编辑`、`Pages:编辑`、`D1:编辑` 权限。 |
| **`CLOUDFLARE_ACCOUNT_ID`** | **必要 🔴** | 无 | 您的 Cloudflare 账户 ID。登录 Cloudflare 控制台在右侧侧边栏即可获取。 |
| **`CLOUDFLARE_D1_DATABASE_ID`** | **非必要 🟢** | 自动查询/自动创建 | 绑定的 D1 数据库 UUID。如果不配置，GitHub Actions 将会自动检测或在您的 Cloudflare 账户中一键创建名为 `dnshe-manager-db` 的 D1 数据库并自动注入绑定。 |
| **`AES_KEY`** | **非必要 🟢** | 自动生成 | 数据库敏感数据加密密钥（AES-GCM）。**不配置也无需担心**：GitHub Actions 首次部署时会自动生成随机密钥并写入 Cloudflare Worker（Secret），且之后保持稳定不变（不会每次部署重新生成，避免已加密数据无法解密）。注意：该密钥**不会自动回填到本仓库 GitHub Secrets**（受限于 GITHUB_TOKEN 权限），如需在本地开发使用，可登录 Cloudflare 控制台查看或自行记录。如已有自定义密钥，填入即可优先使用。 |
| **`ADMIN_TOKEN`** | **非必要 🟢** | 无 | 应急后门 Token。忘记管理员登录密码时的救援凭证。 |
| **`WEBHOOK_URL`** | **非必要 🟢** | 无 | 域名自动续期通知推送的 Webhook 地址。 |

---

### 2. Cloudflare Worker 环境变量 / Secrets（后端运行期）

在 Worker 部署后生效的配置项，可通过 `wrangler.toml` 配置文件或使用 `npx wrangler secret put <KEY>` 命令行/控制台写入：

#### 🔒 密钥 (Secrets) — 强烈建议通过 `wrangler secret put` 注入：
| 密钥名 | 是否必要 | 说明 |
| :--- | :---: | :--- |
| **`AES_KEY`** | **推荐 🟡** | AES-GCM 对称加密密钥。用于对数据库中存储的 API Secret 与 2FA 密钥进行加密保护。经 GitHub Actions 部署时**会自动生成并保持稳定**，无需手动配置；也可手动执行 `wrangler secret put AES_KEY` 覆盖。 |
| **`ADMIN_TOKEN`** | **非必要 🟢** | 应急后门口令。设置后，即使忘记密码也可以使用该口令（或计算出的 TOTP 动态码）作为 Bearer Token 进行紧急登录与 API 鉴权。 |
| **`WEBHOOK_URL`** | **非必要 🟢** | 自动化任务续期通知推送 URL 地址。可在前端面板的【设置】中进行图形化修改。 |

#### ⚙️ 普通配置项 (Vars / `wrangler.toml`)：
| 配置项名 | 是否必要 | 默认值 | 作用与说明 |
| :--- | :---: | :---: | :--- |
| **`DB`** | **必要 🔴** | `dnshe-manager-db` | D1 数据库绑定句柄（`[[d1_databases]]` 节点）。 |
| **`ALLOWED_ORIGIN`** | **非必要 🟢** | `*` (自适应) | 允许的跨域前端 Origin 来源（例如 `https://your-app.pages.dev`）。生产环境建议配置以防接口跨域盗用。 |
| **`WEBHOOK_TYPE`** | **非必要 🟢** | `custom` | Webhook 消息格式类型。可选：`dingtalk` (钉钉)、`feishu` (飞书)、`wecom` (企业微信)、`custom` (通用格式)。 |
| **`DEFAULT_API_KEY`** | **非必要 🟢** | 无 | 部署完成后首次启动时，若存在此配置，系统将自动绑定该 API Key 账号，无需在 UI 手动录入。 |
| **`DEFAULT_API_SECRET`**| **非必要 🟢** | 无 | 搭配 `DEFAULT_API_KEY` 使用的 API Secret。 |
| **`DEFAULT_API_ALIAS`** | **非必要 🟢** | `默认账号` | 默认账号的显示别名。 |

---

### 3. 前端编译环境变量

| 变量名 | 是否必要 | 说明 |
| :--- | :---: | :--- |
| **`VITE_API_BASE_URL`** | **非必要 🟢** | 后端 Worker REST API 的基准 URL（如 `https://dnshe-manager-backend.xxx.workers.dev`）。使用 GitHub Actions 部署时，程序会自动检测 Worker 域名并自动注入该变量，无需手动配置。 |

---

## 🚀 详细部署流程

### 准备工作：获取 Cloudflare 凭证

1. **登录 Cloudflare 仪表盘**：访问 [dash.cloudflare.com](https://dash.cloudflare.com/)。
2. **获取账户 ID (Account ID)**：
   - 在仪表盘右侧侧边栏中找到 **账户 ID (Account ID)**，复制备用。
3. **创建 API 令牌 (API Token)**：
   - 点击右上角头像 -> **我的个人资料 (My Profile)** -> **API 令牌 (API Tokens)** -> **创建令牌 (Create Token)**。
   - 选择 **编辑 Cloudflare Workers (Edit Cloudflare Workers)** 模板。
   - 确保权限列表中包含：
     - `Account -> Cloudflare Workers -> Edit`
     - `Account -> Cloudflare Pages -> Edit`
     - `Account -> D1 -> Edit`
   - 保存并复制生成的 API Token。

---

### 方式一：GitHub Actions 一键全自动部署 (推荐 ⭐⭐⭐⭐⭐)

只需要把本项目 Fork 或 Push 到您自己的 GitHub 仓库中，GitHub Actions 会**全自动**为您创建 D1 数据库、建表、发布后端 Worker 以及编译部署前端 Pages！

1. **配置 GitHub Secrets**：
   - 进入您的 GitHub 仓库 -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**。
   - 依次添加以下两个变量：
     - `CLOUDFLARE_API_TOKEN`: 填入准备工作中获取的 Token。
     - `CLOUDFLARE_ACCOUNT_ID`: 填入准备工作中获取的 Account ID。
     - `AES_KEY`: (可选) 自定义加密密钥。**不填也可以**——首次部署时工作流会自动生成随机 AES_KEY 并写入 Cloudflare Worker（不会自动回填 GitHub Secrets）。
2. **推送代码或手动触发**：
   - 提交代码并 `git push main`，或者进入 GitHub 仓库的 **Actions** 选项卡 -> 点击 **Deploy to Cloudflare** -> 点击 **Run workflow**。
3. **等待部署完成**：
   - 部署完成后，脚本控制台会输出 Cloudflare Pages 前端访问域名。访问该域名即可开启 DNSHE 面板！

---

### 方式二：Cloudflare CLI / Wrangler 手动部署

如果您习惯在本地使用终端发布，请按照以下步骤依次操作：

#### 1. 安装环境与登录 Cloudflare
```bash
# 全局或项目局部安装 Cloudflare CLI 工具 Wrangler
npm install -g wrangler

# 授权登录 Cloudflare
npx wrangler login
```

#### 2. 创建 Cloudflare D1 数据库
```bash
# 创建名为 dnshe-manager-db 的分布式 D1 数据库
npx wrangler d1 create dnshe-manager-db
```
*终端会输出类似如下信息：*
```text
[[d1_databases]]
binding = "DB"
database_name = "dnshe-manager-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
打开根目录下的 `wrangler.toml` 文件，将生成的 `database_id` 替换填入 `database_id = "..."` 处。

#### 3. 执行 SQL 初始化数据表表结构
```bash
# 远程执行建表 SQL 语句
npx wrangler d1 execute dnshe-manager-db --remote --file=./schema.sql
```

#### 4. (推荐) 设置对称加密密钥与环境变量
```bash
# 设置数据加密 AES 密钥 (输入任意强随机字符)
npx wrangler secret put AES_KEY
```

#### 5. 部署后端 Worker
```bash
npx wrangler deploy
```
*发布成功后，终端会打印 Worker 访问地址（如 `https://dnshe-manager-backend.your-subdomain.workers.dev`）。*

#### 6. 构建并发布前端 Cloudflare Pages
```bash
# 进入前端源码目录
cd frontend

# 安装前端依赖
npm install

# 编译打包前端（如果 Worker 使用自定义域名，可先设置 VITE_API_BASE_URL 环境变量）
npm run build

# 部署编译后的 dist 目录到 Cloudflare Pages
npx wrangler pages deploy dist --project-name=dnshe-manager-frontend --branch=main
```
根据控制台输出的 Pages 网址访问面板即可！

---

## 💻 本地二次开发与调试

若您需要对项目源码进行修改或调试：

### 1. 克隆代码与安装依赖

```bash
# 克隆仓库
git clone https://github.com/your-username/dnshe-manager.git
cd dnshe-manager

# 安装后端依赖
npm install

# 安装前端依赖
cd frontend
npm install
cd ..
```

### 2. 初始化本地 D1 数据库模拟环境

```bash
# 在本地 SQLite 虚拟仿真环境中建表
npx wrangler d1 execute dnshe-manager-db --local --file=./schema.sql
```

### 3. 双终端联动启动开发服务

分别打开两个终端窗口：

- **终端 1 (启动后端 Worker 模拟服务)**：
  ```bash
  npm run dev
  ```
  *(后端将运行在 `http://localhost:8787`)*

- **终端 2 (启动前端 Vite 实时热重载服务)**：
  ```bash
  cd frontend
  npm run dev
  ```
  *(前端将运行在 `http://localhost:3000`)*

浏览器打开 `http://localhost:3000` 即可开始本地开发与联调！

---

## 📁 项目目录结构

```text
dnshe-manager/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自动化 CI/CD 构建部署工作流
├── frontend/                   # 前端 React 18 + Vite 项目源码
│   ├── src/
│   │   ├── App.tsx             # 前端主界面组件 (包含面板卡片、域名管理、DNS模态框、安全设置、未读告警铃铛、批量查重引擎)
│   │   ├── punycode.ts         # RFC 3492 Punycode 编解码器 (中文域名 ⇄ xn-- 互转，与后端同源)
│   │   ├── wordbanks.ts        # 可编辑前缀词库 (中英文分类种子数据 + 本地持久化读写)
│   │   ├── main.tsx            # 应用挂载入口
│   │   └── index.css           # Tailwind CSS 样式导入
│   ├── package.json            # 前端依赖配置 (React, Lucide-React, TailwindCSS, qrcode.react)
│   ├── postcss.config.js       # PostCSS 插件配置
│   ├── tailwind.config.js      # Tailwind 样式主题扩展
│   ├── tsconfig.json           # 前端 TS 规范配置
│   └── vite.config.ts          # Vite 开发代理及打包构建配置
├── src/                        # 后端 Cloudflare Worker 源码
│   ├── index.ts                # RESTful API 路由定义 (基于 Hono.js 框架)、鉴权中间件、API 缓存读写、查重池接口与 Worker 入口
│   ├── dnshe.ts                # DNSHE 官方 REST API V2.0 客户端 SDK (HMAC/请求签名逻辑)
│   ├── punycode.ts             # RFC 3492 Punycode 编解码器 (中文域名统一转 xn-- 后送往上游 API)
│   ├── db.ts                   # D1 数据库操作类、AES-GCM 加解密算法、API 缓存/查重池方法与安全日志封装
│   └── cron.ts                 # 每日 Cron Trigger 自动巡检、域名自动续期及多渠道通知
├── schema.sql                  # D1 SQLite 数据库初始化表结构 SQL 脚本 (含 accounts/domains_cache/logs/cache 表)
├── wrangler.toml               # Cloudflare Worker 项目配置文件 (包含 D1 绑定与触发器)
├── package.json                # 后端依赖配置
├── tsconfig.json               # 后端 TS 规范配置
└── README.md                   # 项目详细使用与部署说明文档
```

---

## ❓ 常见问题与注意事项 (FAQ)

#### Q1: 首次访问系统提示“请设置管理员用户名与密码”？
这是系统安全设计的机制。系统初始化时**没有默认密码**，首次访问时，您只需在界面上自行输入您喜爱的管理员用户名和密码（密码至少 8 位），即可完成初始化并自动签发登录 Session。

#### Q2: 忘记管理员登录密码怎么办？
如果您在部署时配置了环境变量/Secret `ADMIN_TOKEN`，可以在登录界面使用 `ADMIN_TOKEN` 作为应急后门访问系统，登录后在【设置】界面直接重置管理员密码。

#### Q3: 添加 NS 记录失败，提示 `disable_ns_management`？
DNSHE 上游平台有时会根据政策选择性关闭特定顶级后缀域名的 NS 修改权限。当平台关闭 NS 接口时，系统会自动捕捉上游返回的 403 限制，并给出友好的中文提示。此时如果需要修改 NS，需登录 DNSHE 官网后台人工调整。

#### Q4: 域名自动续期的触发条件是什么？
- 每日凌晨 02:00（UTC）定时任务会自动扫描数据库中的所有域名。
- 系统比较域名的到期时间（`expires_at`）与当前系统时间。
- 当剩余到期时间**小于等于设置的阈值天数**（默认 180 天）时，自动调用 DNSHE 官方 API 发起续期请求。

#### Q5: 为什么配额 / DNS 记录显示的是旧数据？
这是**智能 API 缓存**机制的正常表现。为了防止频繁调用 DNSHE 官方 API 被判定滥用，所有查询操作默认只读取本地缓存、不会实时调用上游。如果您在 **DNSHE 官网后台**直接修改了数据，面板仍显示旧值，请点击配额页或 DNS 弹窗右上角的「刷新」按钮强制回源同步，或在面板内执行一次写操作（增删改记录 / 注册 / 续期）后自动刷新缓存。

#### Q6: 如何减少对 DNSHE 官方 API 的调用？
- 纯查询（看配额、看 DNS 记录）默认零上游调用，全部命中缓存。
- 只有写操作（增删改 DNS 记录、注册域名、手动续期、同步域名、WHOIS 查重）才会真正调用上游。
- 绑定 / 批量绑定 / 更换 Key 后的**深度域名同步**（自动三态分类 + 缓存预热）会按账号名下域名数量并发调用一次上游，仅此一次，之后读操作全部命中缓存。
- 批量域名查重（规则生成前缀逐个 WHOIS）是唯一的高频调用场景，请合理控制生成数量，避免触发滥用判定。系统已内置三重节流：**跨账号共享查重池**（已注册域名直接跳过）、**官方保留前缀排除**（`ai`/`jd`/`qq`/`mail` 等不发请求）、**单账号 1.2s 限频 + 撞限自动暂停**。

#### Q7: 刷新页面后为什么还能停留在当前页面？
当前选项卡会同步到浏览器 URL 的 Hash 中（如 `#accounts`），刷新、浏览器前进 / 后退、直接分享带 Hash 的链接都会保持原页面。若想回到首页，把地址栏 Hash 清空或手动改为 `#dashboard` 即可。

#### Q8: 中文域名怎么注册？列表里为什么显示中文？
在注册页的二级前缀框**直接输入中文**即可（如 `测试`），系统会自动转换为 `xn--` 形式的 Punycode 提交给 DNSHE，输入时下方会实时显示将要提交的编码结果。域名列表则反向把 `xn--` 解码为中文显示，方便辨认；**点击域名卡片标题会复制 ASCII（`xn--`）原文**，因为 DNS 配置、浏览器地址栏等场景需要的是可被机器解析的 ASCII 形式。

#### Q9: 查重池是什么？会不会给出过期的结论？
查重池把**已确认注册**的域名缓存在后端 D1 中，后续批量扫描直接跳过，避免重复消耗 API 配额，且跨账号、跨设备共享。为防止结论过期，池子做了三重保护：**只缓存「已注册」**（未注册域名随时可能被抢注，不入池）、**7 天后自动失效重验**（覆盖他人续费释放或主动删除后重新可注册的情况）、以及可勾选的**「忽略查重池，强制全部重查」**开关。若池子查询失败，会自动退化为全量扫描，不会阻断流程。

#### Q10: 批量查重扫到一半中断了，要重头再来吗？
不用。点击「暂停查询」会自动保存**断点光标**（当前扫描位置、已查数量、保存时间）到浏览器本地，下次进入页面顶部会出现提示条，可选择「从断点继续」或「清除断点」。若查询触发了 API 限流（HTTP 429）或配额上限，系统也会自动暂停并保住断点，稍后可继续。

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 协议开源，欢迎 Star 🌟、Fork 🍴 以及提交 Issue 与 PR！
