import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/x402/index.ts", "src/solana-agent-kit/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
