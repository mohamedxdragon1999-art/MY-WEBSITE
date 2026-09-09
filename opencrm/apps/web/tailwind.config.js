/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" },
        brand: { DEFAULT: "#7c6cff", hover: "#8f82ff", deep: "#5a4bd6", subtle: "#1d1b33" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], display: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
