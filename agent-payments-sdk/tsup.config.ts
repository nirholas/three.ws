// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "evm/index": "src/evm/index.ts",
    "solana/index": "src/solana/index.ts",
    "solana/legacy-agent-payments/index": "src/solana/legacy-agent-payments/index.ts",
    "solana/solana-agent-kit/index": "src/solana/solana-agent-kit/index.ts",
    "x402/index": "src/x402/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
