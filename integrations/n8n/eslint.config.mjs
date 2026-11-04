import { config } from '@n8n/node-cli/eslint';

export default [{ ignores: ['test/**', 'dist/**', 'vitest.config.mjs'] }, ...config];
