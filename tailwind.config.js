/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#263d35',
        leaf: '#174c3c',
        secondary: '#26765b',
        lime: '#b8e986',
        mint: '#e8f3ec',
        chartBlue: '#5685f5',
        chartViolet: '#9275e8',
        warning: '#e9a23b',
        error: '#e36b70',
        mist: '#f5f7f5',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
