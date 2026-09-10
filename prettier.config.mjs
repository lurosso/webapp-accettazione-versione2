// Prettier 3: stile unico del repository; il plugin Tailwind ordina le classi.
/** @type {import('prettier').Config} */
const config = {
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
};

export default config;
