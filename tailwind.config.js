/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0B0C10',
        'bg-panel': '#14161D',
        'bg-surface': '#1C1F2A',
        'bg-surface-hover': '#252A38',
        'bg-surface-elevated': '#282D3C',
        'border-subtle': '#262A36',
        'border-focus': '#3E4559',
        'accent-coral': '#FF5733',
        'accent-coral-hover': '#FF6E4E',
        'accent-amber': '#FFAA00',
        'accent-cyan': '#00E5FF',
        'accent-emerald': '#10B981',
        'accent-ruby': '#EF4444',
        'text-primary': '#F8FAFC',
        'text-secondary': '#94A3B8',
        'text-muted': '#64748B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
