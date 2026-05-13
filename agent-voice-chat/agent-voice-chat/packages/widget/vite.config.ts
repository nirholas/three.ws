// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AgentVoiceChat',
      formats: ['iife', 'es'],
      fileName: (format) => {
        if (format === 'iife') return 'agent-voice-chat.min.js';
        return 'agent-voice-chat.esm.js';
      },
    },
    rollupOptions: {
      // Socket.IO is loaded externally for IIFE, bundled for ESM
      external: (id) => {
        if (id === 'socket.io-client') return true;
        return false;
      },
      output: {
        exports: 'named',
        globals: {
          'socket.io-client': 'io',
        },
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: false, passes: 2 },
    },
    sourcemap: true,
    target: 'es2020',
  },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
});


