// Live verification of the packaged visual: the compiled bundle inside
// dist/*.pbiviz is loaded into real Chromium, created through the
// powerbi-visuals-utils-testutils host exactly the way Power BI creates it, and
// pointed at production three.ws models. Run with `npm run verify:live`.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import JSZip from "jszip";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const lookups = [];

/** Reads the newest .pbiviz in dist/ and returns the compiled visual it ships. */
async function loadPackage() {
    const dist = join(root, "dist");
    const files = (await readdir(dist)).filter((f) => f.endsWith(".pbiviz"));
    if (files.length === 0) throw new Error("dist/ has no .pbiviz. Run `npm run package` first.");
    const file = join(dist, files.sort().at(-1));
    const bytes = await readFile(file);
    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.keys(zip.files).find((name) => /^resources\/.+\.pbiviz\.json$/.test(name));
    if (!entry) throw new Error(`${file} has no resources/*.pbiviz.json`);
    const manifest = JSON.parse(await zip.files[entry].async("string"));
    return {
        file: file.slice(root.length),
        bytes: bytes.length,
        guid: manifest.visual.guid,
        version: manifest.visual.version,
        js: manifest.content.js,
        css: manifest.content.css,
    };
}

/**
 * Model-id lookups go to production. Until the forge-creation CORS change
 * (commit 3a90bdcc4) is deployed, production answers without
 * access-control-allow-origin, so the header that change adds is added here and
 * every lookup is recorded so the report says whether it was needed.
 */
async function routeModelLookups(ctx) {
    await ctx.page.route("https://three.ws/api/forge-creation**", async (route) => {
        const response = await route.fetch();
        const headers = response.headers();
        const injected = !headers["access-control-allow-origin"];
        if (injected) headers["access-control-allow-origin"] = "*";
        lookups.push({ url: route.request().url(), status: response.status(), injected });
        await route.fulfill({ response, headers });
    });
}

function modelLookups() {
    return lookups;
}

export default defineConfig({
    test: {
        include: ["test/live/**/*.live.ts"],
        testTimeout: 120_000,
        browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            viewport: { width: 1000, height: 640 },
            commands: { loadPackage, routeModelLookups, modelLookups },
            provider: playwright({
                launchOptions: {
                    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
                },
            }),
            instances: [{ browser: "chromium" }],
        },
    },
});
