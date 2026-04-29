import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "x-spaces/", "agent-voice-chat/", "public/js/"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
)


