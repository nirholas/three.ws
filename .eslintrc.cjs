module.exports = {
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'warn',
  },
  plugins: [
    'import',
    'promise',
    'jsdoc',
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.mjs'],
      },
    },
  },
};
