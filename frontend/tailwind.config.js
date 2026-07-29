/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 自定义一些高端、质感更好的暗色系调色板
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
          900: "#0f151f",
          950: "#090d14",
        }
      }
    },
  },
  plugins: [],
}
