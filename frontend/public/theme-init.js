// 在 React 挂载前根据 localStorage 提前设置主题类，避免刷新时闪白。
// 刻意做成外部脚本而非内联 <script>：CSP 的 script-src 已收紧为 'self'，
// 内联脚本会被浏览器拦截导致主题初始化失效。
(function () {
  try {
    var t = localStorage.getItem("DNSHE_THEME") || "dark";
    if (t === "dark") document.documentElement.classList.add("dark");
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();
