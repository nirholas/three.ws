import { defineConfig } from "tsup";

export default defineConfig({
  tsconfig: "tsconfig.build.json",
  entry: [
    "src/index.ts",
    "src/wallet/index.ts",
    "src/x402-exact/index.ts",
    "src/solana-agent-kit/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: { compilerOptions: { noUnusedLocals: false, noUnusedParameters: false } },
  clean: true,
  sourcemap: true,
  splitting: false,
});
