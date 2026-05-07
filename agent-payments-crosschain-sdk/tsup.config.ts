import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "evm/index": "src/evm/index.ts",
    "solana/index": "src/solana/index.ts",
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
