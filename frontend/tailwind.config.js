/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 语义化配色 —— 映射到 index.css 中的 CSS 变量，随明暗主题自动切换
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        hovered: "var(--bg-hover)",
        "border-base": "var(--border-base)",
        "border-soft": "var(--border-soft)",
        "content-primary": "var(--text-primary)",
        "content-secondary": "var(--text-secondary)",
        "content-muted": "var(--text-muted)",
        accent: "var(--accent)",
        // 自定义一些高端、质感更好的暗色系调色板（保留兼容）
        dark: {
          50: "#f6f6f9",
          100: "#eef1f6",
          200: "#dbe3ef",
          300: "#bdcbe0",
          400: "#96afce",
          500: "#698eb8",
          600: "#53749e",
          700: "#435d81",
          800: "#1a2433",
          850: "#131b28",
          900: "#0f151f",
          950: "#090d14",
        }
      }
    },
  },
  plugins: [],
}
