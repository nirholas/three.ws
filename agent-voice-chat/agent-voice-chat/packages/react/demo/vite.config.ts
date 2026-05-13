// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  resolve: {
    alias: {
      '@agent-voice-chat/react': resolve(__dirname, '../src/index.ts'),
      '@agent-voice-chat/core': resolve(__dirname, '../../core/src/index.ts'),
    },
  },
  server: { port: 5173 },
});


