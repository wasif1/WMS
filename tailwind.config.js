/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '!./src/i18n/ur.ts', '!./src/**/*.test.*'],
  theme: { extend: { colors: { slate: { 50:'rgb(var(--s-50) / <alpha-value>)',100:'rgb(var(--s-100) / <alpha-value>)',200:'rgb(var(--s-200) / <alpha-value>)',300:'rgb(var(--s-300) / <alpha-value>)',400:'rgb(var(--s-400) / <alpha-value>)',500:'rgb(var(--s-500) / <alpha-value>)',600:'rgb(var(--s-600) / <alpha-value>)',700:'rgb(var(--s-700) / <alpha-value>)',800:'rgb(var(--s-800) / <alpha-value>)',900:'rgb(var(--s-900) / <alpha-value>)',950:'rgb(var(--s-950) / <alpha-value>)' }, brand: { 50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 900: '#312e81' } }, boxShadow: { card: '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.08)' } } },
  plugins: [],
}
