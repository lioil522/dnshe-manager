# 🌐 DNSHE 跨账号多域名自动化集中管理面板

[![Cloudflare Workers](https://img.shields.io/badge/Backend-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Frontend-Cloudflare_Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-Cloudflare_D1_SQL-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一款专为 **DNSHE 免费域名用户** 设计的现代化、全自动跨账号集中托管控制面板。基于 **Cloudflare Serverless 架构** 开发，完全免费托管于 Cloudflare 平台（支持 Serverless 零成本运行）。

---

## 🌟 核心功能特色

- **🔑 跨账号集中管理**：一次性绑定多个 DNSHE 账号 API Key，在一个高颜值面板下统筹管理所有名下的子域名及 DNS 解析记录。
- **🏷️ 域名三态智能识别**：自动识别域名的健康与配置状态：
  - **`未解析`** (灰调)：使用官方默认 NS，但尚未添加任何解析记录。
  - **`已解析`** (绿调)：使用官方默认 NS，且已配置有效解析记录（支持面板在线一键编辑）。
  - **`已委派`** (蓝调)：已托管至第三方 NS（如 Cloudflare/DNSPod 等），下级解析交由外部处理。
- **🛡️ NS 域名服务器智能切换**：支持在线添加自定义第三方 NS 委派（提供【强制替换冲突记录】能力），并支持一键恢复为官方默认 NS（`ns1.dnshe.com` / `ns2.dnshe.com`）。
- **⏳ 终身无人值守自动续期**：内置每日 Cron Trigger 自动巡检任务，域名到期前 15 天自动触发免费续期，无需人工干预。
- **🔔 Webhook 消息通知**：支持绑定钉钉、飞书、企业微信或自定义 Webhook，在域名成功续期或发生异常时第一时间发送推送提醒。
- **🔐 AES-GCM 高强度加密**：所有绑定的账号 API Secret 在 Cloudflare D1 数据库中均通过 AES-GCM 对称算法加密保存，保障密钥安全。

---

## 🏗️ 系统技术架构

```text
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Pages (前端 UI)                  │
│       React 18 + TypeScript + Tailwind CSS + Lucide Icons   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP API
┌──────────────────────────────▼──────────────────────────────┐
│                Cloudflare Workers (后端 API)                 │
│              Hono.js 框架 + Router + Security Auth           │
└──────┬───────────────────────┬──────────────────────┬───────┘
       │                       │                      │
┌──────▼───────┐       ┌───────▼────────┐     ┌───────▼───────┐
│ Cloudflare D1│       │ Cron Trigger   │     │ DNSHE Official│
│ SQL 数据库    │       │ 每日 02:00 巡检 │     │ REST API V2.0 │
└──────────────┘       └────────────────┘     └───────────────┘
```

---

## 🚀 云端部署指南

系统支持两种部署方式：**GitHub Actions 一键全自动部署** (推荐) 与 **Cloudflare Pages 控制台部署**。

### 方式一：GitHub Actions 全自动部署 (推荐)

只要向本仓库 Push 代码，GitHub Actions 将会自动打包部署前端与后端。

1. **获取 Cloudflare API 凭证**：
   - 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) -> 点击右上角头像 -> **我的个人资料** -> **API 令牌** -> **创建令牌** -> 选择 **编辑 Cloudflare Workers** 模板创建。
   - 记录生成的 `API Token` 以及控制台右侧的 `Account ID` (账户 ID)。
2. **在 GitHub 仓库添加 Secrets**：
   - 打开 GitHub 仓库 -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**。
   - 依次添加以下两个变量：
     - `CLOUDFLARE_API_TOKEN`: 填入您的 Cloudflare API Token。
     - `CLOUDFLARE_ACCOUNT_ID`: 填入您的 Cloudflare Account ID。
3. **提交推送代码**：
   - 执行 `git push`，GitHub 会自动运行 `.github/workflows/deploy.yml` 脚本，将 Worker 后端与 Pages 前端自动发布上线！

---

### 方式二：Cloudflare 控制台 / Pages 手动部署

#### 1. 部署后端 Worker & 创建 D1 数据库

在项目根目录下打开终端：

```bash
# 登录 Cloudflare 账号
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create dnshe-manager-db

# 提示：将命令输出的 database_id 替换写入本地 wrangler.toml 文件中
```

初始化数据库表结构并部署 Worker：

```bash
# 执行数据库建表语句
npx wrangler d1 execute dnshe-manager-db --remote --file=./schema.sql

# 部署后端 Worker
npx wrangler deploy

# 设置数据库加密 AES 密钥 (任意强随机字符串)
npx wrangler secret put AES_KEY
```

#### 2. 部署前端 Cloudflare Pages

1. 登录 Cloudflare 仪表盘 -> 进入 **`Workers 和 Pages`** -> 点击 **`创建`** -> **`Pages`** -> 选择 **`连接到 GitHub`**。
2. 选择您的仓库，填写构建参数：
   - **框架预设**：`Vite` 或 `Create React App`
   - **根目录 (Root directory)**：`frontend` *(重要：在高级选项中填写)*
   - **构建命令 (Build command)**：`npm run build`
   - **构建输出目录 (Build output directory)**：`dist`
3. 点击 **保存并部署** 即可发布前端！

---

## 💻 本地开发与调试

如果您需要对项目进行本地二次开发或联调：

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd frontend
npm install
cd ..
```

### 2. 初始化本地数据库模拟环境

```bash
npx wrangler d1 execute dnshe-manager-db --local --file=./schema.sql
```

### 3. 启动开发服务器

分别打开两个终端：

- **终端 1 (启动后端 Worker 服务)**：
  ```bash
  npm run dev
  ```
  *(后端开发服务运行在 `http://localhost:8787`)*

- **终端 2 (启动前端 Vite 界面)**：
  ```bash
  cd frontend
  npm run dev
  ```
  *(前端开发服务运行在 `http://localhost:3000`)*

访问 `http://localhost:3000` 即可开始本地调试！

---

## 📁 项目目录结构

```text
dnshe-manager/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自动构建部署工作流
├── frontend/                   # 前端 React 项目源码
│   ├── src/
│   │   ├── App.tsx             # 主界面组件 (包含域名卡片、NS/DNS模态框)
│   │   ├── main.tsx            # 应用入口
│   │   └── index.css           # Tailwind CSS 样式
│   ├── package.json            # 前端依赖与构建脚本
│   └── vite.config.ts          # Vite 开发代理配置
├── src/                        # 后端 Hono / Worker 源码
│   ├── index.ts                # RESTful API 路由与逻辑
│   ├── dnshe.ts                # DNSHE 官方 API V2.0 Client 客户端封装
│   ├── db.ts                   # D1 数据库操作与日志记录封装
│   └── cron.ts                 # 每日定时巡检与自动续期逻辑
├── schema.sql                  # D1 SQL 数据库表结构初始化脚本
├── wrangler.toml               # Cloudflare Worker 配置文件
└── README.md                   # 项目说明文档
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 协议开源，欢迎 Star / Fork 与提交 PR！
