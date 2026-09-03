/**
 * 静态资源处理器（自建 Docker 版专用）
 *
 * Cloudflare Pages 那一侧的托管与缓存策略由 frontend/public/_headers 描述，
 * 自建版没有 Pages，这里用同一套语义把前端产物直接发出去：
 *   /assets/*    文件名带内容哈希 → 一年 immutable 长缓存
 *   index.html   每次校验，避免发新版后用户一直拿旧 HTML 引用已删除的旧资源
 *
 * 另外承担 SPA 兜底：非 /api 的未知路径统一返回 index.html，交给前端路由处理。
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
};

/**
 * 安全响应头（与 src/index.ts 的 SECURITY_HEADERS 保持一致，Cloudflare 侧见
 * frontend/public/_headers —— 三处必须同步维护，改了 CSP 记得一起改）。
 *
 * NOTE: script-src 收紧为 'self'，因此前端必须把内联主题脚本外置到 theme-init.js，
 * 不能再往 index.html 里写内联 <script>。
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function cacheControlFor(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  // theme-init.js 不带内容哈希，必须每次校验，否则发新版后浏览器仍拿旧脚本决定主题
  if (urlPath === "/theme-init.js" || urlPath === "/" || urlPath.endsWith(".html")) {
    return "public, max-age=0, must-revalidate";
  }
  return "public, max-age=3600";
}

interface ResolvedFile {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/**
 * 创建静态资源处理器
 *
 * @param rootDir 前端产物目录（Docker 镜像里是 /app/public，本地开发是 frontend/dist）
 */
export function createStaticHandler(rootDir: string) {
  const root = path.resolve(rootDir);
  const indexFile = path.join(root, "index.html");

  async function resolveFile(candidate: string): Promise<ResolvedFile | null> {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        return resolveFile(path.join(candidate, "index.html"));
      }
      return { filePath: candidate, size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  }

  async function send(
    req: Request,
    file: ResolvedFile,
    urlPath: string,
    status = 200
  ): Promise<Response> {
    // 弱 ETag 用 大小 + mtime 生成：index.html 走 must-revalidate，有 ETag 才能回 304
    // 而不是每次刷新都重传一遍整个 HTML
    const etag = `W/"${file.size.toString(16)}-${Math.floor(file.mtimeMs).toString(16)}"`;
    const headers: Record<string, string> = {
      "Content-Type": contentTypeFor(file.filePath),
      "Cache-Control": cacheControlFor(urlPath),
      ETag: etag,
      "Last-Modified": new Date(file.mtimeMs).toUTCString(),
      "X-Content-Type-Options": "nosniff",
      ...SECURITY_HEADERS,
    };

    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    if (req.method === "HEAD") {
      return new Response(null, { status, headers: { ...headers, "Content-Length": String(file.size) } });
    }

    const body = await readFile(file.filePath);
    return new Response(body, { status, headers });
  }

  return async function handleStatic(req: Request): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const url = new URL(req.url);
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // 目录穿越防护：解析成绝对路径后必须仍落在 root 之内
    const target = path.resolve(root, `.${path.posix.normalize(decodedPath)}`);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    const found = await resolveFile(target);
    if (found) {
      return send(req, found, url.pathname);
    }

    // SPA 兜底：把未命中的路径交给前端。带扩展名的请求（漏掉的图片 / JS）
    // 不兜底，否则 404 会伪装成一份 HTML，把报错变成看不懂的解析失败。
    if (!path.extname(decodedPath)) {
      const index = await resolveFile(indexFile);
      if (index) {
        return send(req, index, "/index.html");
      }
      return new Response(
        "前端产物未找到：请确认 STATIC_DIR 指向前端构建输出目录（含 index.html）",
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  };
}
