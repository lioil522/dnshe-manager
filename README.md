# DNSHE 跨账号多域名自动化集中管理面板 (Cloudflare Serverless 版)

本系统是一款**专为 DNSHE 免费域名用户设计**的多账号自动化托管控制面板。系统完全基于 Cloudflare Serverless 架构设计，前端托管在 **Cloudflare Pages**，后端 API 运行在 **Cloudflare Workers** 上，数据库使用 **Cloudflare D1 SQL** 数据库。

整个系统在 Cloudflare 上**可以完全零成本免费托管**，具有高颜值、安全、跨账户集中管理等特点。

---

## 🌟 核心特色

1. **跨账户统一看板**：一次性绑定多个 DNSHE 账号 API Key，在一个页面下跨账号检索、全局搜索所有子域名及名下 DNS 解析。
2. **「终身免费」无人值守自动续期**：后台内置每日定时任务 (Cron Trigger)。当检测到域名剩余有效期小于或等于 15 天（即进入免费续期窗口）时，系统将**全自动向官方接口发起续期申请**，实现域名“永久在线”。
3. **Webhook 推送通知**：当自动续期成功或失败时，系统将自动向您配置的 Webhook 地址（支持钉钉、企业微信、飞书机器人、自定义接口）推送详细报告。
4. **DNS 解析极速托管**：提供清爽的 DNS 解析增删改查面板，支持 A / AAAA / CNAME / TXT / MX / NS / CAA / SRV 解析线路。
5. **安全存储 (AES-GCM)**：在 Cloudflare D1 数据库中存储的 API Secret 由 Worker 在解密密钥（环境变量 `AES_KEY`）的保障下通过 AES-GCM 进行对称加密，即使数据库意外泄露也无法获取您的密钥。

---

## 🛠️ 本地开发与调试联调

### 1. 准备工作
请确保您本地已安装 **Node.js** 环境（推荐 Node.js v18+）。

在项目根目录下，分别安装后端与前端的依赖依赖项：
```bash
# 1. 安装后端 Worker 依赖项
cd dnshe-manager
npm install

# 2. 安装前端 React 依赖项
cd frontend
npm install
cd ..
```

### 2. 初始化本地 D1 数据库
Wrangler 可以在本地模拟 Cloudflare D1 数据库。执行以下命令以使用本地 SQLite 文件初始化表结构：
```bash
npx wrangler d1 execute dnshe-manager-db --local --file=./schema.sql
```

### 3. 运行本地开发服务器

打开两个终端窗口，分别启动后端与前端服务：

* **终端 1：启动 Worker 后端 (端口 8787)**
  ```bash
  cd dnshe-manager
  npm run dev
  ```
  *(本地运行时，Worker 会使用本地 D1 模拟库)*

* **终端 2：启动 React 前端 (端口 3000)**
  ```bash
  cd dnshe-manager/frontend
  npm run dev
  ```
  *(前端 Vite 已配置反向代理，所有 `/api/*` 请求会被自动转发至本地 8787 端口的 Worker 服务)*

打开浏览器访问 `http://localhost:3000` 即可开始使用！

---

## 🚀 线上 Cloudflare 部署教程

### 第一步：在 Cloudflare 上创建 D1 数据库
在终端中登录您的 Cloudflare 账号，并创建一个新的 D1 数据库：
```bash
# 登录 Cloudflare
npx wrangler login

# 创建名为 dnshe-manager-db 的 D1 数据库
npx wrangler d1 create dnshe-manager-db
```
创建成功后，终端会输出类似如下的数据库配置信息：
```toml
[[d1_databases]]
binding = "DB"
database_name = "dnshe-manager-db"
database_id = "xxxx-xxxx-xxxx-xxxx"
```
打开 `wrangler.toml` 文件，将 `database_id` 替换为您刚刚生成的实际 ID 值。

### 第二步：在线上初始化 D1 表结构
使用本地的 `schema.sql` 对线上刚创建的 D1 数据库进行表结构初始化：
```bash
npx wrangler d1 execute dnshe-manager-db --remote --file=./schema.sql
```

### 第三步：部署后端 Worker 并配置环境变量
1. **部署 Worker**：
   ```bash
   npx wrangler deploy
   ```
2. **配置秘钥安全密钥 (`AES_KEY`)**：
   在终端中为您部署的 Worker 录入 AES 密钥（任意 16 或 32 位强随机字符串均可），用于对数据库中的 Secret 进行加密：
   ```bash
   npx wrangler secret put AES_KEY
   ```
   *(根据提示输入您的密钥)*
3. **配置 Webhook 通知地址 (`WEBHOOK_URL`)** *(可选)*：
   如果您想接收每日域名自动续期的结果推送，可以配置通知地址：
   ```bash
   npx wrangler secret put WEBHOOK_URL
   ```

### 第四步：构建并部署前端 React 至 Cloudflare Pages

1. **打包编译前端**：
   ```bash
   cd frontend
   npm run build
   cd ..
   ```
   编译打包完成后，前端静态文件会输出至 `frontend/dist` 目录下。

2. **部署至 Cloudflare Pages**：
   您可以将 `frontend/dist` 目录上传至 Cloudflare Pages 中进行托管。
   * **方法 A（控制台手动上传）**：登录 Cloudflare 网页端后台 -> Workers 与 Pages -> 创建 Pages -> 上传资产 -> 选择 `frontend/dist` 文件夹上传即可。
   * **方法 B（CLI 快速发布）**：
     ```bash
     npx wrangler pages deploy frontend/dist --project-name=dnshe-panel
     ```

---

## 📝 运维与说明

1. **自动续期 Cron 定时任务时间**：
   `wrangler.toml` 中配置了定时任务 `0 2 * * *`（每天凌晨 2 点执行）。当您部署完成后，Cloudflare 平台会自动托管并在此时间点准时触发到期检测与自动续期任务。
2. **多账号绑定的验证流程**：
   当您在管理面板上新增账号时，系统会在后端自动调用 DNSHE 配额接口进行握手测试，只有握手成功（证明 API Key 和 Secret 有效且没过期）时才允许绑定。
3. **日志排查**：
   当出现续期失败或任何上游网络异常时，系统会第一时间写入本地的 `logs` 表，并在“运行日志” Tab 中提供完整的调试堆栈或返回消息。

祝您使用愉快！如有问题请提交 Issue 交流。
