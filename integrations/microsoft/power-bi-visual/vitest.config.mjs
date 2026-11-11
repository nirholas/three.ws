// Unit tests run in real Chromium (Vitest browser mode over Playwright) so the
// visual gets a real DOM, real WebGL (SwiftShader) and real fetch, exactly as
// it does inside a Power BI report iframe.
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        testTimeout: 60_000,
        browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
                launchOptions: {
                    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
                },
            }),
            instances: [{ browser: "chromium" }],
        },
    },
});
