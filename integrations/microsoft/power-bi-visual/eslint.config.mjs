import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: ["node_modules/**", "dist/**", ".vscode/**", ".tmp/**", "src/generated/**", "test/**", "scripts/**", "vitest.config.mjs", "eslint.config.mjs"],
    },
];
