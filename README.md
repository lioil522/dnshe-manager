# 🌐 DNSHE-Manager

> DNSHE 跨账号多域名自动化集中管理系统

[![构建自建镜像](https://github.com/lioil522/dnshe-manager/actions/workflows/docker.yml/badge.svg)](https://github.com/lioil522/dnshe-manager/actions/workflows/docker.yml)
[![部署到 Cloudflare](https://github.com/lioil522/dnshe-manager/actions/workflows/deploy.yml/badge.svg)](https://github.com/lioil522/dnshe-manager/actions/workflows/deploy.yml)

DNSHE-Manager 是一个面向 [DNSHE](https://my.dnshe.com) 用户的**多账号域名集中管理面板**，支持域名资产看板、DNS 解析托管、到期自动续期、多平台通知推送等功能。同一套代码同时支持 **Cloudflare Workers** 和 **Docker 自建** 两种部署形态。

---

## ✨ 功能特性

- **多账号管理** — 支持绑定多个 DNSHE API Key，跨账号统一管理域名资产
- **域名资产看板** — 一览所有域名的状态、到期时间、DNS 托管商等信息
- **DNS 解析管理** — 在面板内直接增删改 DNS 记录（A / AAAA / CNAME / MX / TXT 等）
- **自动续期** — 每日定时扫描即将到期的域名并自动续期，无人值守
- **域名同步** — 自动从 DNSHE 上游拉取最新域名列表与状态，支持深度同步
- **DNS 托管商识别** — 通过 DoH 查询 NS 记录，自动识别 Cloudflare / DNSPod / Vercel 等托管商
- **通知推送** — 支持钉钉、飞书、企业微信、Server酱、自定义 Webhook 等多平台通知
- **安全认证** — 用户名 + 密码登录，密码经 PBKDF2 加盐哈希存储；可选 2FA (TOTP) 两步验证
- **AES-GCM 加密** — API Secret 与 2FA 密钥使用 AES-GCM 加密存储，支持密钥自动生成
- **深色 / 浅色主题** — 支持主题切换，刷新无闪白
- **国际化域名** — 支持 Punycode 编码的国际化域名

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    DNSHE-Manager                        │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │   前端 (SPA)  │    │        后端 (Hono)            │   │
│  │  React + TS   │───▶│  src/index.ts  (共享业务)     │   │
│  │  Vite + TW    │    │  src/db.ts     (数据层)       │   │
│  │  Lucide Icons │    │  src/cron.ts   (定时任务)     │   │
│  └──────────────┘    │  src/dnshe.ts  (API 客户端)   │   │
│                      └──────────┬───────────────────┘   │
│                                 │                       │
│              ┌──────────────────┼──────────────────┐    │
│              ▼                  ▼                  ▼    │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ Cloudflare Workers │  │  Docker 自建   │                 │
│  │  D1 Database    │  │  SQLite (内置)  │                 │
│  │  Cron Trigger   │  │  定时器         │                 │
│  │  Pages (可选)   │  │  同端口同源     │                 │
│  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 部署方式

### 方式一：Cloudflare Workers — GitHub Actions 一键部署（推荐）

适合不想自建服务器、追求零运维的用户。Fork 仓库后配置 Secrets，推送到 `main` 即自动部署。

#### 1. Fork 仓库

在 GitHub 上 Fork 本仓库到自己的账号下。

#### 2. 获取 Cloudflare 凭据

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)：

- **Account ID**：在任意域名的「概述」页右侧栏可以找到
- **API Token**：进入「我的个人资料」→「API 令牌」→「创建令牌」，需要以下权限：

| 权限 | 说明 |
|------|------|
| `Workers Scripts:编辑` | 部署 Worker 后端 |
| `D1:编辑` | 自动创建 / 绑定 D1 数据库 |
| `Pages:编辑` | 部署前端到 Cloudflare Pages |
| `Workers Routes:编辑` | 自动检测自定义域名 |
| `Zone:读取` | 查询域名路由 |

#### 3. 配置 GitHub Secrets

进入 Fork 仓库的 `Settings` → `Secrets and variables` → `Actions`，添加以下 Secrets：

| Secret 名称 | 是否必填 | 说明 |
|-------------|---------|------|
| `CLOUDFLARE_API_TOKEN` | ✅ 必填 | 上一步创建的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ 必填 | Cloudflare 账户 ID |
| `CLOUDFLARE_D1_DATABASE_ID` | 可选 | D1 数据库 ID，留空则自动创建 |
| `AES_KEY` | 可选 | 加密密钥，留空则首次部署自动生成 |
| `ADMIN_TOKEN` | 可选 | 应急后门令牌 |
| `WEBHOOK_URL` | 可选 | 通知推送地址 |

#### 4. 触发部署

配置完 Secrets 后，任选一种方式触发：

- **推送到 main 分支**（自动触发）
- **手动触发**：进入 `Actions` → `Deploy to Cloudflare` → `Run workflow`

#### 工作流自动完成的事项

部署工作流会自动处理以下所有步骤，无需手动干预：

1. ✅ 查询或创建 D1 数据库（`dnshe-manager-db`）
2. ✅ 自动检测 Worker 是否绑定了自定义域名，并配置前端 API 地址
3. ✅ 部署 Worker 后端
4. ✅ 生成或同步 AES_KEY 加密密钥
5. ✅ 同步可选 Secrets（`ADMIN_TOKEN` / `WEBHOOK_URL`）到 Worker
6. ✅ 构建前端并部署到 Cloudflare Pages（`dnshe-manager-frontend`）

> **💡 首次部署后**，浏览器打开 Pages 分配的域名（如 `dnshe-manager-frontend.pages.dev`），在登录页自行设置管理员用户名与密码。

---

### 方式二：Docker 自建

适合有自己服务器、想完全掌控数据的用户。只需一个 `docker-compose.yml` 即可启动：

```bash
# 1. 下载 docker-compose.yml
curl -O https://raw.githubusercontent.com/lioil522/dnshe-manager/main/docker-compose.yml

# 2. 启动（所有环境变量均有默认值，无需额外配置）
docker compose up -d

# 3. 浏览器打开 http://<服务器IP>:8787
#    首次进入自行设置管理员用户名与密码
```

> **💡 自定义配置：** 如需调整环境变量，直接编辑 `docker-compose.yml` 中的 `environment` 段，把 `${VAR:-}` 替换成实际值即可：
>
> ```yaml
> environment:
>   AES_KEY: your-secret-key        # 替换 ${AES_KEY:-}
>   WEBHOOK_URL: https://your-hook  # 替换 ${WEBHOOK_URL:-}
>   WEBHOOK_TYPE: dingtalk          # 替换 ${WEBHOOK_TYPE:-}
> ```
>
> 也可以创建 `.env` 文件，compose 会自动读取。变量说明见下方[环境变量](#️-环境变量)章节。

**更新到最新版：**

```bash
docker compose pull && docker compose up -d
```

> **⚠️ 大陆网络提示：** `ghcr.io` 拉取可能很慢，可在 `.env` 中设置镜像站：
>
> ```
> IMAGE_REPO=ghcr.nju.edu.cn/lioil522/dnshe-manager
> ```

#### 镜像说明

- 多架构支持：`amd64` / `arm64`，Docker 自动匹配
- 运行时镜像**不含 node_modules**，后端由 esbuild 打包为单文件（约 244KB）
- 以 `node` 用户（uid 1000）运行，非 root
- 内置 HEALTHCHECK，30 秒检测一次

---

## ⚙️ 环境变量

所有变量均为**可选**，全部留空也能正常启动。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `IMAGE_TAG` | Docker 镜像版本 | `latest` |
| `IMAGE_REPO` | Docker 镜像地址 | `ghcr.io/lioil522/dnshe-manager` |
| `AES_KEY` | AES-GCM 加密密钥，用于加密 API Secret 与 2FA 密钥 | 自动生成并保存到 `/data/aes.key` |
| `ADMIN_TOKEN` | 应急后门令牌，忘记密码时的兜底登录方式 | 不启用 |
| `WEBHOOK_URL` | Webhook 推送地址 | — |
| `WEBHOOK_TYPE` | Webhook 类型：`dingtalk` / `feishu` / `wecom` / `serverchan` / `custom` | — |
| `ALLOWED_ORIGIN` | CORS 允许的来源（逗号分隔），自建版同源无需配置 | — |
| `DEFAULT_API_KEY` | 首次启动自动绑定的 DNSHE API Key | — |
| `DEFAULT_API_SECRET` | 首次启动自动绑定的 DNSHE API Secret | — |
| `DEFAULT_API_ALIAS` | 默认账号别名 | — |
| `CRON_UTC_HOUR` | 定时任务执行时刻（UTC 小时） | `2`（北京时间 10:00） |
| `CRON_UTC_MINUTE` | 定时任务执行时刻（UTC 分钟） | `0` |
| `DISABLE_CRON` | 设为 `1` 关闭每日自动同步与续期 | — |
| `TZ` | 容器内日志时区 | `Asia/Shanghai` |

> **⚠️ 备份提醒：** 无论 `AES_KEY` 是手动配置还是自动生成，都必须与数据库一起备份。密钥丢失后，数据库中加密的 API Secret 和 2FA 密钥将无法解密。

---

## 📁 项目结构

```
DNSHE-Manager/
├── src/                        # 共享业务代码（Workers 与自建版共用）
│   ├── index.ts                #   Hono 路由与 API 处理
│   ├── db.ts                   #   数据库管理器（加密、鉴权、CRUD）
│   ├── cron.ts                 #   定时任务（域名同步、自动续期、通知推送）
│   ├── dnshe.ts                #   DNSHE API 客户端
│   ├── dns-provider.ts         #   DNS 托管商识别
│   └── punycode.ts             #   国际化域名编码
│
├── server/                     # 自建版专属（Node.js 运行时适配）
│   ├── index.ts                #   Node 入口（env 绑定、定时器、AES 密钥自举）
│   ├── d1-sqlite.ts            #   D1 → SQLite 适配层（Node 内置 node:sqlite）
│   ├── d1-sqlite.test.ts       #   适配层自检（17 项测试）
│   ├── static.ts               #   静态资源服务（SPA 兜底、ETag、缓存头）
│   └── tsconfig.json           #   自建侧 TypeScript 配置
│
├── frontend/                   # 前端（React + TypeScript + Vite）
│   ├── src/
│   │   ├── App.tsx             #   主应用组件
│   │   ├── main.tsx            #   入口
│   │   ├── dnsrecords.ts       #   DNS 记录类型定义
│   │   ├── geodata.ts          #   地理数据（线路选择）
│   │   ├── rulegen.ts          #   规则生成器
│   │   └── ...
│   ├── .env.selfhost           #   自建模式环境变量（API 基准地址 = /）
│   ├── vite.config.ts          #   Vite 配置（开发代理到 8787）
│   └── tailwind.config.js      #   Tailwind CSS 配置
│
├── .github/workflows/
│   ├── docker.yml              #   自建镜像构建与发布（amd64 + arm64）
│   └── deploy.yml              #   Cloudflare Workers 部署
│
├── schema.sql                  # 数据库表结构
├── Dockerfile                  # 三阶段构建（前端 → 后端 → 运行时）
├── docker-compose.yml          # Docker Compose 编排
├── wrangler.toml               # Cloudflare Workers 配置
├── .env.example                # 环境变量示例
└── package.json                # 后端依赖与脚本
```

---

## 🛠️ 本地开发

### 前置要求

- **Node.js** ≥ 22.5（自建版需要内置的 `node:sqlite`）
- **npm**
- **Wrangler**（仅 Cloudflare Workers 开发需要）

### Cloudflare Workers 模式

```bash
# 安装依赖
npm install

# 启动后端（默认端口 8787）
npm run dev

# 启动前端（默认端口 3000，自动代理 /api 到 8787）
cd frontend
npm install
npm run dev
```

### 自建模式

```bash
# 安装依赖
npm install

# 类型检查
npx tsc --noEmit          # Workers 侧
npm run verify:node       # 自建侧

# 适配层自检
npm run test:node         # 17 项测试

# 构建与运行
npm run build:node
npm run start:node
```

---

## 📝 数据库结构

| 表名 | 用途 |
|------|------|
| `accounts` | API 账号（别名、API Key、加密后的 API Secret） |
| `domains_cache` | 域名缓存（状态、到期时间、DNS 托管商、续期记录） |
| `logs` | 系统运行日志（同步、续期、鉴权、操作等分类） |
| `cache` | API 上游响应缓存（防止频繁调用被判定滥用） |

---

## ❓ 常见问题

### Cloudflare 版与自建版有什么区别？

功能完全一致，差异仅在基础设施层面：

| | Cloudflare Workers | Docker 自建 |
|---|---|---|
| 数据库 | D1 (SQLite) | Node 内置 `node:sqlite` |
| 定时任务 | Cron Trigger | 进程内定时器 |
| 前端发布 | Cloudflare Pages | 同端口同源发出 |
| CORS | 需要配置 `ALLOWED_ORIGIN` | 同源，无需配置 |
| 运维 | Cloudflare 托管 | 自行运维 |

### 如何从 Cloudflare 迁移到自建？

D1 和自建版用的都是 SQLite，表结构完全一致。导出 D1 数据库后直接放入 `/data` 目录即可。注意 `AES_KEY` 必须保持一致。

### 大陆网络拉取 Docker 镜像很慢怎么办？

在 `.env` 中配置镜像站：

```env
IMAGE_REPO=ghcr.nju.edu.cn/lioil522/dnshe-manager
```

Docker 的 `registry-mirrors` 只代理 Docker Hub，对 `ghcr.io` 无效。

### 忘记管理员密码怎么办？

如果配置了 `ADMIN_TOKEN` 环境变量，可以使用它作为兜底登录方式。如果未配置，需要删除数据库中的管理员数据重新初始化。

---

## 📄 许可证

本项目基于开源许可证发布，详情请查看 [LICENSE](LICENSE) 文件。
