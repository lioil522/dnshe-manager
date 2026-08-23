# 🌐 DNSHE 跨账号多域名自动化集中管理面板

[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Frontend-Cloudflare_Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare_D1_SQL-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Docker](https://img.shields.io/badge/Self--host-Docker-2496ED?logo=docker&logoColor=white)](#方式三docker-自建部署)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

专为 **DNSHE 免费域名用户** 打造的跨账号集中托管控制面板：一处绑定多个账号，统一管理域名资产、DNS 解析记录与 NS 委派，并无人值守自动续期。

基于 Cloudflare Serverless 全家桶（**Workers + Pages + D1**）构建，无需采购服务器，可零成本免费托管；也可以用 **Docker 自建**，同一套业务代码把 D1 换成本地 SQLite、Cron Trigger 换成进程内定时器，前后端同源跑在一个容器里（见[方式三](#方式三docker-自建部署)）。

---

## 🌟 功能速览

| 模块 | 能力 |
| :--- | :--- |
| **跨账号管理** | 绑定多个 DNSHE 账号（API Key + Secret + 别名），别名留空则自动解析；支持一次粘贴多组密钥批量绑定（单次 ≤ 50）；绑定后自动深度同步域名并预热缓存；配额并发查询。 |
| **域名三态识别** | 自动判定 `未解析` / `已解析` / `已委派`，并从 NS 记录识别托管商（Cloudflare / DNSPod / Vercel / vps8），结果缓存于 D1，浏览列表不额外发起公共 DNS 查询。 |
| **DNS 解析记录** | `A / AAAA / CNAME / TXT / MX / NS / CAA / SRV` 八种类型的增 / 改 / 删。行内编辑就地保存；批量添加（多行文本 ≤ 50 条，提交前有解析预览）、批量修改（逐字段勾选覆盖，记录值可逐条编辑）、批量删除（勾选 + 确认清单）；逐条返回成功 / 失败原因，不会一条失败就整体报错。 |
| **NS 智能切换** | 一键添加自定义 NS（可一次多个，自动去重）、强制替换冲突记录、一键恢复官方默认 NS 或清理残留 NS 记录；上游禁用 NS 管理时给出中文指引。 |
| **自动续期** | Cloudflare Cron 每日 02:00 (UTC) 巡检，剩余有效期低于阈值（默认 180 天）时自动续期，并清理过期日志。 |
| **消息通知** | 钉钉 / 飞书 / 企业微信 / Server酱（方糖）/ 自定义 Webhook，以及 Telegram Bot 原生推送，两者都可在控制台做连通性测试。各平台按自己的规范构造 payload（Server酱 是「标题 + 正文」两段式）；这些平台在 token 失效时往往回 HTTP 200 并把错误码藏在响应体里，因此推送结果按响应体判定，失败会写入运行日志。 |
| **安全防护** | API Secret 与 2FA 密钥经 256 位 AES-GCM 加密入库；管理员密码 PBKDF2 加盐哈希；支持 2FA (TOTP)；`ADMIN_TOKEN` 应急通道；Session 有效期 7 天，过期会话由每日 Cron 清理。 |
| **WHOIS 与注册** | 在线查询可注册状态、面板内一键注册（成功后增量入库）。域名删除需手动回填完整域名二次确认，并在提交前拦截 `ServerHold` / `PendingDelete` / 仍存在解析记录等情形。 |
| **中文域名** | 内置零依赖 RFC 3492 Punycode 编解码器（前后端同源）：直接输入中文注册并实时预览编码、列表反解为中文显示、点击复制 ASCII 原文；中文与 `xn--` 双形态索引，两种关键词都能搜到。 |
| **批量查重引擎** | 花括号槽位规则（如 `{城市}{数字}`）取各槽位笛卡尔积，24 个内置标签与可增删改的中英文词库均可作为标签自由组合；实时预估组合数与耗时（上限 30 万条）。多账号并发流水线、顺序递增扫描、断点续查、429 自动暂停、官方保留前缀排除、结果导出 txt。 |
| **共享查重池** | 已确认注册的域名写入后端 D1，跨账号 / 跨设备共享，扫描时命中即跳过以省下上游配额；只缓存「已注册」结论且 7 天后自动失效重验，也可勾选强制全部重查。 |
| **API 缓存** | 读操作（看配额、看 DNS 记录）默认只命中 D1 缓存、零上游调用；写操作成功后自动回源回填；配额页与 DNS 弹窗提供「刷新」按钮强制回源。 |
| **前端体验** | 选项卡同步 URL Hash（刷新 / 前进后退 / 分享链接均停留原页）、域名按账号分组折叠且状态记忆、未读告警铃铛、明暗主题切换。 |
| **手机端适配** | ~390px 宽即可操作，断点对齐 Tailwind `md` (768px)，≥768px 桌面渲染与适配前一致：侧栏改抽屉、运行日志与 DNS 记录表格改卡片、弹窗统一 `max-h-[90dvh]`、视口用 `dvh`、窄屏输入框兜底 16px 以免 iOS 聚焦时缩放。 |

> **词表口径**：规则里的拼音、地理、英文词性与邮编词表照搬西部数码域名查询客户端反编译源码的 `Words.DomainWords()`，口径为「照搬源码 + 修正明确缺陷」，每处增删都在源码行内标注。因此 `{声母}{韵母}` 产出的是 480 个可发音音节，而不是字母对。

> **性能要点**：加载速度取决于每个请求的串行 D1 往返次数（单次约 300–450ms），而非带宽。表结构自举每 isolate 只跑一次、鉴权配置合并为单条查询、全局数据不随切页重拉、`/assets/*` 长缓存 immutable。

---

## 🏗️ 系统架构

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

自建（Docker）版共用 `src/` 下的同一套业务代码，只把运行时依赖换掉 —— 前端由后端同端口发出，因此前后端同源、不需要 CORS：

```text
┌─────────────────────────────────────────────────────────────┐
│            单个容器 :8787（前后端同源，无需配置 CORS）            │
│   静态文件处理器（发前端产物） + Hono.js 路由（/api/* 与鉴权）      │
└──────┬───────────────────────┬──────────────────────┬───────┘
       │                       │                      │
┌──────▼───────┐       ┌───────▼────────┐     ┌───────▼───────┐
│  SQLite 文件  │       │  进程内定时器   │     │ DNSHE Official│
│  /data 数据卷 │       │ 每日 02:00 UTC │     │ REST API V2.0 │
└──────────────┘       └────────────────┘     └───────────────┘
```

替换只发生在 `server/` 下的三个文件里，`src/` 一行未改：`d1-sqlite.ts` 用 `node:sqlite` 实现 D1 的接口（含 `batch()` 的事务原子性与外键级联），`index.ts` 组装 env 绑定、`waitUntil` 替身与每日定时器，`static.ts` 负责发前端产物。

---

## 🔑 环境变量与密钥

### 1. GitHub Secrets（GitHub Actions 部署用）

仓库 **Settings → Secrets and variables → Actions** 中配置：

| 变量名 | 必要性 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | 必要 🔴 | 无 | 需具备 `Workers:编辑`、`Pages:编辑`、`D1:编辑` 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 必要 🔴 | 无 | Cloudflare 控制台右侧侧边栏可获取 |
| `CLOUDFLARE_D1_DATABASE_ID` | 可选 🟢 | 自动创建 | 不填则自动检测或创建 `dnshe-manager-db` 并注入绑定 |
| `AES_KEY` | 可选 🟢 | 自动生成 | 不填则首次部署自动生成随机密钥写入 Worker Secret，之后保持稳定。**不会回填到 GitHub Secrets**（受 GITHUB_TOKEN 权限限制），需要本地开发时请到 Cloudflare 控制台查看 |
| `ADMIN_TOKEN` | 可选 🟢 | 无 | 忘记密码时的应急救援凭证 |
| `WEBHOOK_URL` | 可选 🟢 | 无 | 续期通知推送地址 |

### 2. Worker Secrets（`wrangler secret put <KEY>` 注入）

| 密钥名 | 必要性 | 说明 |
| :--- | :---: | :--- |
| `AES_KEY` | 推荐 🟡 | 加密数据库中的 API Secret 与 2FA 密钥。经 Actions 部署会自动生成，无需手配 |
| `ADMIN_TOKEN` | 可选 🟢 | 应急后门口令，可用该口令或其 TOTP 动态码作为 Bearer Token 登录 |
| `WEBHOOK_URL` | 可选 🟢 | 续期通知推送地址，也可在面板【设置】里改 |

### 3. Worker Vars（`wrangler.toml`）

| 配置项 | 必要性 | 默认值 | 说明 |
| :--- | :---: | :---: | :--- |
| `DB` | 必要 🔴 | `dnshe-manager-db` | D1 绑定句柄（`[[d1_databases]]` 节点） |
| `ALLOWED_ORIGIN` | 可选 🟢 | `*` | 允许的前端 Origin，逗号分隔多个。**前端同时挂 `pages.dev` 与自定义域名时两个都要写**，否则未列出的那个登录会报 `Failed to fetch` |
| `WEBHOOK_TYPE` | 可选 🟢 | `custom` | `dingtalk` / `feishu` / `wecom` / `serverchan` / `custom` |
| `DEFAULT_API_KEY` | 可选 🟢 | 无 | 首次启动时自动绑定该账号，省去手动录入 |
| `DEFAULT_API_SECRET` | 可选 🟢 | 无 | 配合 `DEFAULT_API_KEY` |
| `DEFAULT_API_ALIAS` | 可选 🟢 | `默认账号` | 默认账号别名 |

### 4. 前端编译变量

| 变量名 | 必要性 | 说明 |
| :--- | :---: | :--- |
| `VITE_API_BASE_URL` | 可选 🟢 | 后端 Worker API 基准 URL。Actions 部署会自动检测并注入，无需手配。自建版由 `frontend/.env.selfhost` 固定为 `/`（同源相对路径），也无需手配 |

### 5. 自建（Docker）版环境变量

上面 2、3 两节的变量在自建版里同名同义，改由容器环境变量传入（见 `.env.example` 与 `docker-compose.yml`）。差异只有这几处：

| 变量名 | 默认值 | 与 Cloudflare 版的差异 |
| :--- | :--- | :--- |
| `AES_KEY` | 自动生成 | 留空则首次启动生成随机密钥写入 `/data/aes.key`（**必须随数据库一起备份**） |
| `ALLOWED_ORIGIN` | 无需配置 | 前后端同源，不涉及跨域；仅在把前端单独部署到别的域名时才需要 |
| `DB` | 无 | 不存在。数据库是 `/data/dnshe.db`，路径可用 `DATA_DIR` / `DB_PATH` 覆盖 |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 仅自建版有 |
| `STATIC_DIR` | `/app/public` | 前端产物目录；本地未设时自动探测 `./public` 与 `./frontend/dist` |
| `CRON_UTC_HOUR` / `CRON_UTC_MINUTE` | `2` / `0` | 定时任务时刻（UTC），等价于 `wrangler.toml` 的 `crons` |
| `DISABLE_CRON` | 无 | 设为 `1` 彻底关闭每日同步与自动续期 |

---

## 🚀 部署

先取好 Cloudflare 凭证：控制台右侧侧边栏复制 **Account ID**；头像 → My Profile → API Tokens → Create Token，选 **Edit Cloudflare Workers** 模板，确认权限含 `Workers:Edit`、`Pages:Edit`、`D1:Edit`。

### 方式一：GitHub Actions 一键部署（推荐 ⭐）

Fork 或 Push 本项目到自己的仓库，工作流会自动创建 D1、建表、发布 Worker 并编译部署 Pages。

1. 配置 Secrets：`CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`（`AES_KEY` 可不填）。
2. `git push main`，或在 **Actions → Deploy to Cloudflare → Run workflow** 手动触发。
3. 部署日志末尾会输出 Pages 前端域名，访问即可。

### 方式二：Wrangler 手动部署

```bash
# 1. 安装并登录
npm install -g wrangler
npx wrangler login

# 2. 创建 D1，并把输出的 database_id 填进根目录 wrangler.toml
npx wrangler d1 create dnshe-manager-db

# 3. 远程建表
npx wrangler d1 execute dnshe-manager-db --remote --file=./schema.sql

# 4. （推荐）设置加密密钥，输入任意强随机字符
npx wrangler secret put AES_KEY

# 5. 部署后端 Worker，终端会打印 Worker 地址
npx wrangler deploy

# 6. 构建并部署前端（Worker 用自定义域名时先设 VITE_API_BASE_URL）
cd frontend && npm install && npm run build
npx wrangler pages deploy dist --project-name=dnshe-manager-frontend --branch=main
```

### 方式三：Docker 自建部署

不用 Cloudflare 账号，一个容器跑完前端 + 后端 + 数据库，数据全在自己手里。只需要装了 Docker 的机器（无需 Node，镜像内也没有任何需要编译的原生模块）。

镜像由 GitHub Actions 构建并发布到 GHCR，**amd64 / arm64 双架构**，拉取时自动匹配。所以既不用克隆仓库、也不用在本机构建 —— 两个文件就够：

```bash
mkdir dnshe-manager && cd dnshe-manager
curl -O https://raw.githubusercontent.com/lioil522/dnshe-manager/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/lioil522/dnshe-manager/main/.env.example

docker compose up -d
```

打开 `http://<服务器IP>:8787`，在登录页自行设置管理员用户名与密码即可开始使用。前端与 API 同源，**不需要配置后端地址、也不需要配 CORS**。

| 项 | 值 |
| :--- | :--- |
| 镜像 | `ghcr.io/lioil522/dnshe-manager:latest`；地址与版本可用 `.env` 的 `IMAGE_REPO` / `IMAGE_TAG` 覆盖 |
| 端口 | `8787`（改 `docker-compose.yml` 的 `ports`；只在本机监听写 `127.0.0.1:8787:8787`） |
| 数据 | 命名卷 `dnshe-data` → 容器内 `/data`：`dnshe.db`（SQLite）与 `aes.key`（自动生成的加密密钥） |
| 定时任务 | 进程内定时器，每日 `02:00 UTC`（= 北京时间 10:00），与 Cloudflare 版的 Cron 完全同一份代码 |
| 环境变量 | 见 `.env.example`，与 Cloudflare 版的 Worker 变量同名同义 |
| 健康检查 | `GET /healthz`（会真读一次数据库），已配进镜像的 `HEALTHCHECK` |

常用运维：

```bash
docker compose logs -f            # 看日志（含下一次定时任务的时间）
docker compose restart            # 重启
docker compose pull               # 拉取最新镜像
docker compose up -d              # 滚动更新到刚拉下来的镜像（数据卷不动）
docker run --rm -v dnshe-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/dnshe-backup.tar.gz -C /data .      # 备份数据卷
```

想改代码后跑自己的构建：克隆仓库，把 `docker-compose.yml` 里 `build: .` 那行的注释去掉，然后 `docker compose up -d --build`。

> [!IMPORTANT]
> **备份要连 `aes.key` 一起备。** 未配置 `AES_KEY` 时，首次启动会自动生成一份随机密钥写入 `/data/aes.key`。这个密钥丢了，库里已加密的 API Secret 与 2FA 密钥都解不开，只能重新绑定账号。想自己掌管密钥就在 `.env` 里填 `AES_KEY`。

> [!NOTE]
> **出站可达性与 Cloudflare 版不同。** 自建版从你自己的网络出站，不再享受 Cloudflare 边缘的畅通：
> - **拉镜像**要能访问 `ghcr.io`。大陆网络下它基本拉不动：IPv6 会被重置，IPv4 实测只有几十 KB/s，而 Docker 的 `registry-mirrors` 只代理 Docker Hub、对 ghcr.io 无效。这时在 `.env` 里换镜像站即可（`IMAGE_REPO=ghcr.nju.edu.cn/lioil522/dnshe-manager`，实测同一个摘要、35 秒拉完）。
> - **DNS 托管商识别**（域名三态里的「已委派」判定）走公共 DoH。解析器列表已追加国内可达的 `dns.alidns.com` 兜底，并给每次查询加了 5 秒超时，因此大陆网络下仍可用，只是首次查询会先白等前两家超时（结论缓存 30 天，只付一次）。
> - **Telegram 推送**需要能访问 `api.telegram.org`，大陆网络通常不可达。国内环境请改用钉钉 / 飞书 / 企业微信 / Server酱，这些都能直连。
> - **DNSHE 官方 API**（`api005.dnshe.com`）在国内可直连，不受影响。

裸机 Node 运行（不用 Docker，需 Node ≥ 22.5）：

```bash
npm install && npm run build:node                     # 打包后端（单文件，含依赖）
cd frontend && npm install && npm run build:selfhost && cd ..   # 构建前端（同源模式）
npm run start:node                                    # 默认 :8787，数据落 ./data
```

这条路径上的配置要自己导出到环境里（`export AES_KEY=...`，PowerShell 用 `$env:AES_KEY="..."`）——`.env` 只被 docker compose 读取，不会被 `npm run start:node` 自动加载。

---

## 💻 本地开发

```bash
git clone https://github.com/your-username/dnshe-manager.git
cd dnshe-manager
npm install
cd frontend && npm install && cd ..

# 在本地 SQLite 仿真环境建表
npx wrangler d1 execute dnshe-manager-db --local --file=./schema.sql
```

双终端启动：终端 1 在根目录跑 `npm run dev`（后端 `http://localhost:8787`），终端 2 在 `frontend/` 跑 `npm run dev`（前端 `http://localhost:3000`）。浏览器打开 3000 端口即可联调。

清理本地缓存：`npm run clean:local`，Windows 也可双击 `clean-local.cmd`。会删除 `.wrangler`（**含本地 D1 数据**）、`frontend/node_modules/.vite`、`frontend/dist` 与可能存在的 `.cache`。

> [!WARNING]
> 本地 D1 数据永久删除且不备份。脚本对目标路径做项目目录边界校验，**不会连接或删除远程 Cloudflare D1**。运行前请先停掉 Worker / Vite 服务。

改动 `server/` 或 `src/db.ts` 后建议跑一遍这三条（镜像构建时也会跑前两条，跑不过就构建失败）：

```bash
npm run verify:node    # 自建侧类型检查（tsc -p server，含 src/）
npm run test:node      # D1 → SQLite 适配层自检（batch 原子性、meta.changes、外键级联等 17 项）
npx tsc --noEmit       # Cloudflare Worker 侧类型检查
```

也可以不用 wrangler、直接以自建形态联调（一个端口，前后端同源）：

```bash
npm run build:node && cd frontend && npm run build:selfhost && cd ..
npm run start:node     # http://127.0.0.1:8787 ，数据落 ./data
```

---

## 📁 目录结构

```text
dnshe-manager/
├── .github/workflows/
│   ├── deploy.yml                 # 部署到 Cloudflare（Workers + Pages + D1）
│   └── docker.yml                 # 构建自建镜像并发布到 GHCR（amd64 / arm64 双架构）
├── src/                           # 后端业务代码（Cloudflare Worker 与自建版共用）
│   ├── index.ts                   # Hono 路由、鉴权中间件、表结构自举、缓存与查重池接口
│   ├── dnshe.ts                   # DNSHE 官方 REST API V2.0 客户端（请求签名）
│   ├── dns-provider.ts            # 按 NS 记录识别 DNS 托管商
│   ├── punycode.ts                # RFC 3492 Punycode 编解码器
│   ├── db.ts                      # D1 操作、AES-GCM 加解密、会话、缓存 / 查重池、日志
│   └── cron.ts                    # 每日巡检：自动续期、清理过期缓存与会话、推送通知
├── server/                        # 仅自建（Docker / 裸机 Node）版需要，src/ 不依赖它
│   ├── index.ts                   # Node 入口：env 绑定、waitUntil 替身、每日定时器、优雅退出
│   ├── d1-sqlite.ts               # 用 node:sqlite 实现 D1 接口（batch 事务、meta.changes、外键级联）
│   ├── d1-sqlite.test.ts          # 适配层自检（npm run test:node），镜像构建时会跑
│   ├── static.ts                  # 静态资源处理器：缓存头、ETag/304、SPA 兜底、目录穿越防护
│   └── tsconfig.json              # 自建侧类型检查（需 @types/node，与根配置分开）
├── frontend/                      # 前端 React 18 + Vite
│   ├── src/
│   │   ├── App.tsx                # 主界面（域名 / DNS 管理 / 安全设置 / 查重引擎）
│   │   ├── dnsrecords.ts          # 记录类型、相对名转换、批量文本解析与字段合并
│   │   ├── rulegen.ts             # 规则引擎（槽位解析、笛卡尔积、组合数预估）
│   │   ├── pinyin.ts              # 拼音音节表与双拼惰性迭代器
│   │   ├── geodata.ts             # 城市拼音 / 城市简写 / 省份简写 / 电话区号
│   │   ├── enwords.ts             # 英文词表（常见单词 / 名词 / 动词 / 形容词）
│   │   ├── zipcodes.ts            # 邮编词表（照搬源码生成，勿手工编辑）
│   │   ├── wordbanks.ts           # 可编辑词库（种子数据 + 本地持久化与增量补种）
│   │   ├── punycode.ts            # 与后端同源的编解码器
│   │   └── index.css              # Tailwind 与主题变量
│   ├── public/_headers            # Pages 响应头：/assets/* 长缓存 immutable
│   ├── .env.selfhost              # 自建版构建变量：把 API 基准地址烘焙成同源相对路径
│   └── tailwind.config.js         # 主题与字体栈扩展
├── scripts/clean-local.ps1        # 本地缓存 / Wrangler 状态 / 本地 D1 安全清理
├── clean-local.cmd                # Windows 双击式清理入口
├── Dockerfile                     # 自建镜像：三阶段构建，运行时无 node_modules、无原生模块
├── docker-compose.yml             # 一条命令起服务（端口 / 数据卷 / 环境变量）
├── .env.example                   # 自建版环境变量样例（全部可选）
├── schema.sql                     # 初始化表结构（D1 与本地 SQLite 共用）
└── wrangler.toml                  # Worker 配置（D1 绑定与 Cron 触发器）
```

---

## ❓ FAQ

**首次访问提示「请设置管理员用户名与密码」？**
系统没有默认密码。首次访问时自行输入用户名与密码（至少 8 位）即完成初始化并签发 Session。

**忘记管理员密码怎么办？**
若部署时配置了 `ADMIN_TOKEN`，在登录页用它作为应急凭证进入，然后在【设置】里重置密码。

**为什么配额 / DNS 记录显示旧数据？**
这是 API 缓存的正常表现——读操作默认只走本地缓存，以免频繁调用上游被判定滥用。若你在 DNSHE 官网后台直接改过数据，点配额页或 DNS 弹窗的「刷新」按钮强制回源，或在面板内做一次写操作即可。

**自动续期的触发条件？**
每日 02:00 (UTC) Cron 扫描全部域名，比较 `expires_at` 与当前时间，剩余天数 ≤ 阈值（默认 180 天）时调用官方续期 API。

**添加 NS 记录失败，提示 `disable_ns_management`？**
DNSHE 上游会按政策关闭特定后缀的 NS 修改权限。后端捕获该 403 并给出中文提示，此时需登录 DNSHE 官网后台人工调整。

**怎么减少对 DNSHE 官方 API 的调用？**
纯查询零上游调用；只有写操作（改记录 / 注册 / 续期 / 同步 / WHOIS 查重）才真正请求上游。批量查重是唯一高频场景，已内置四重节流：共享查重池跳过已注册域名、官方保留前缀不发请求、单账号 1.2s 限频且撞限自动暂停、日志 1/50 采样。

**批量查重扫到一半中断，要重头再扫吗？**
不用。暂停时会把断点光标（当前位置、已查数量、时间）存到浏览器本地，下次进页面可选「从断点继续」或「清除断点」；触发 429 或配额上限时也会自动暂停并保住断点。

**为什么突然被退回登录页？**
Session 有效期 7 天，到期后接口返回 403、前端清理凭据回登录页，重新登录即可，属预期行为。从旧版本升级上来的旧会话不会被立刻踢下线，会在 7 天内由 Cron 逐步回收；若把代码回滚到旧版本，新格式会话会被判为失效，需重登一次。

**面板加载慢，配了 Cloudflare「优选 IP」为什么没改善？**
优选只能优化「客户端 ↔ Cloudflare 边缘」这一段，而主要耗时发生在边缘**之后**——Worker 到 D1 主库的串行往返。三个常见误区：Pages 自定义域名是 CNAME 到 `*.pages.dev`，客户端只拿到 Cloudflare 自己的 anycast 地址，优选不生效；给后端配优选可能更慢，因为流量被导向离 D1 更远的边缘节点；域名指向会绕回 Cloudflare 的中转 IP 会触发 `Error 1000`，边缘直接 403、Worker 根本不执行。

排查服务端开销：`curl -s -o /dev/null -w "%{time_starttransfer}\n" https://<后端域名>/api/auth/status`，再对比一个不查库的路径（如任意 404），差值即 D1 部分耗时。

**Docker 自建版和 Cloudflare 版有功能差别吗？**
业务代码是同一份，功能完全一致，只有两处环境差异：一是自建版从你自己的网络出站，DNS 托管商识别与 Telegram 推送受本地网络可达性影响（见方式三的说明）；二是自建版本地读库是微秒级，没有 Worker 到 D1 主库那 300–450ms 的往返，页面明显更快。

**已经在 Cloudflare 上跑了，怎么把数据搬到自建版？**
D1 就是 SQLite，导出再导入即可（表结构两边共用 `schema.sql`）：

```bash
npx wrangler d1 export dnshe-manager-db --remote --output=d1-dump.sql
docker compose up -d                                    # 先让容器建好数据卷
docker compose stop                                     # 导入期间停服，避免写冲突
docker run --rm -i -v dnshe-data:/data alpine sh -c \
  "rm -f /data/dnshe.db*"                               # 清掉空库（保留 aes.key）
docker run --rm -i -v dnshe-data:/data -v "$PWD":/in alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/dnshe.db < /in/d1-dump.sql"
docker compose start
```

搬完后 API Secret 与 2FA 密钥仍是密文，必须把 Cloudflare 上那份 `AES_KEY` 填进自建版的 `.env`（`docker compose up -d` 生效），否则这些字段解不开。管理员密码是 PBKDF2 哈希，不受密钥影响，照旧可登录。

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 协议开源，欢迎 Star 🌟、Fork 🍴 以及提交 Issue 与 PR。
