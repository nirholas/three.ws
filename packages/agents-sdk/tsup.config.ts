import { defineConfig } from "tsup";

// One entry, ESM and CJS, with declarations. The on-chain error classes are
// imported from ../../solana-agent-sdk/src/errors.ts by relative path, so
// tsup inlines them: the published package has zero runtime dependencies.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  platform: "neutral",
});
