/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // three.ws monochrome base (public/tokens.css: --bg-0, --bg-1, --ink).
        surface: {
          50:  '#e8e8e8',
          100: '#d4d4d4',
          200: '#262626',
          300: '#1f1f1f',
          400: '#1a1a1a',
          500: '#0a0a0a',
        },
        // three.ws identity violet (public/tokens.css: --accent-violet,
        // --accent-violet-strong, and the rgb(139, 92, 246) wallet fill).
        accent: {
          DEFAULT: '#8b5cf6',
          light:   '#c4b5fd',
          dark:    '#6d28d9',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        slide: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        slide: 'slide 1.5s ease-in-out infinite',
      },
    }
  },
  plugins: []
}
