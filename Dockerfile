# DNSHE-Manager 自建镜像
#
# 与 Cloudflare 版共用 src/ 下的全部业务代码，差异只在 server/ 那三个文件：
# D1 换成本地 SQLite、Cron Trigger 换成定时器、前端由同一个端口发出（同源，免配 CORS）。
#
# 运行时镜像里没有 node_modules —— esbuild 已把后端连依赖一起打成单文件，
# SQLite 用的是 Node 内置的 node:sqlite，没有任何需要编译的原生模块。
#
#   docker compose up -d --build

# ---------- 阶段 1：构建前端 ----------
FROM node:24-bookworm-slim AS frontend
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# selfhost 模式会读 frontend/.env.selfhost，把 API 基准地址烘焙成 "/"（同源相对路径）
RUN npm run build:selfhost


# ---------- 阶段 2：类型检查 + 打包后端 ----------
FROM node:24-bookworm-slim AS backend
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY server/ ./server/
# 先过一遍 tsc 再打包：类型出问题就让镜像构建直接失败，而不是等运行时才炸
RUN npm run verify:node && npm run test:node && npm run build:node


# ---------- 阶段 3：运行时 ----------
FROM node:24-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public \
    SCHEMA_FILE=/app/schema.sql

COPY --from=backend /app/dist-node/server.mjs ./server.mjs
COPY --from=frontend /app/frontend/dist ./public
COPY schema.sql ./schema.sql

# 数据目录预先归属 node 用户：命名卷会继承镜像里的属主，非 root 也能写
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
