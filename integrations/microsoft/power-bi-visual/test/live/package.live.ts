import powerbi from "powerbi-visuals-api";
import { createVisualHost } from "powerbi-visuals-utils-testutils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, page } from "vitest/browser";

import { dataView, LIVE_GLB } from "../helpers";

interface PackageInfo {
    file: string;
    bytes: number;
    guid: string;
    version: string;
    js: string;
    css: string;
}

interface Lookup {
    url: string;
    status: number;
    injected: boolean;
}

declare module "vitest/browser" {
    interface BrowserCommands {
        loadPackage(): Promise<PackageInfo>;
        routeModelLookups(): Promise<void>;
        modelLookups(): Promise<Lookup[]>;
    }
}

type Plugin = { create(options: powerbi.extensibility.visual.VisualConstructorOptions): powerbi.extensibility.visual.IVisual };

/** The brass desk lamp: its by-id lookup returns a meshopt + WebP web GLB. */
const MODEL_ID = "18656b0c-796d-4518-9e6e-07c6e22a2d29";
/** Production's optimizer re-encodes this avatar with KHR_draco_mesh_compression. */
const DRACO_GLB = "https://three.ws/api/avatar/optimize?src=https://three.ws/avatars/cesium-man.glb&draco=1";

let info: PackageInfo;
let plugin: Plugin;

beforeAll(async () => {
    info = await commands.loadPackage();
    await commands.routeModelLookups();
    const style = document.createElement("style");
    style.textContent = info.css;
    document.head.appendChild(style);
    const w = window as unknown as { powerbi: { visuals: { plugins: Record<string, Plugin> } } };
    w.powerbi = { visuals: { plugins: {} } };
    const script = document.createElement("script");
    script.textContent = info.js;
    document.head.appendChild(script);
    plugin = w.powerbi.visuals.plugins[info.guid];
    document.body.style.cssText = "margin:0;background:#f3f2f1";
});

afterAll(async () => {
    const lookups = await commands.modelLookups();
    console.info(`[verify-live] package ${info.file} (${info.bytes} B, ${info.guid} ${info.version})`);
    for (const l of lookups) console.info(`[verify-live] lookup ${l.status} ${l.url}${l.injected ? " (CORS header added pending deploy)" : ""}`);
});

function create(width: number, height: number) {
    const element = document.createElement("div");
    element.style.cssText = `position:relative;width:${width}px;height:${height}px;background:#fff;margin:8px`;
    document.body.appendChild(element);
    const host = createVisualHost({});
    const outcome: { finished: unknown[]; failed: Array<[unknown, string]> } = { finished: [], failed: [] };
    let resolve: ((v: "finished" | "failed") => void) | null = null;
    let current: unknown = null;
    host.eventService.renderingStarted = () => undefined;
    host.eventService.renderingFinished = (o) => { outcome.finished.push(o); if (o === current) resolve?.("finished"); };
    host.eventService.renderingFailed = (o, reason) => { outcome.failed.push([o, String(reason)]); if (o === current) resolve?.("failed"); };
    const visual = plugin.create({ element, host } as powerbi.extensibility.visual.VisualConstructorOptions);
    return {
        element,
        outcome,
        render(view: powerbi.DataView) {
            const options = { viewport: { width, height }, dataViews: [view], type: 2 } as unknown as powerbi.extensibility.visual.VisualUpdateOptions;
            current = options;
            const done = new Promise<"finished" | "failed">((r) => { resolve = r; });
            visual.update(options);
            return done;
        },
        destroy() {
            visual.destroy?.();
        },
    };
}

function tiles(element: HTMLElement): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>(".tws-tile"));
}

function paintedShare(element: HTMLElement): number {
    const canvas = element.querySelector("canvas") as HTMLCanvasElement;
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted++;
    return painted / (probe.width * probe.height);
}

describe("packaged visual against production three.ws", () => {
    it("registers itself the way Power BI loads a .pbiviz", () => {
        expect(info.file).toMatch(/^dist\/threeWsModels[0-9A-F]+\.1\.0\.0\.0\.pbiviz$/);
        expect(typeof plugin?.create).toBe("function");
    });

    it("renders a GLB URL, a model id and a Draco GLB side by side", async () => {
        const v = create(960, 360);
        const outcome = await v.render(dataView({
            category: { name: "Source", values: ["GLB URL", "Model id", "Draco GLB"] },
            model: { name: "Model", values: [LIVE_GLB, MODEL_ID, DRACO_GLB] },
            colorBy: { name: "Score", values: [10, 20, 30] },
        }));
        expect(outcome).toBe("finished");
        expect(v.outcome.failed).toEqual([]);
        const labels = tiles(v.element).map((t) => t.getAttribute("aria-label"));
        expect(labels).toEqual(["GLB URL, 3D model", "Model id, 3D model", "Draco GLB, 3D model"]);
        expect(paintedShare(v.element)).toBeGreaterThan(0.05);
        await page.screenshot({ path: "out/live-url-id-draco.png", element: v.element });

        const lookups = await commands.modelLookups();
        expect(lookups.some((l) => l.url.includes(MODEL_ID) && l.status === 200)).toBe(true);
        v.destroy();
    });

    it("names a model looked up by id from its three.ws record", async () => {
        const v = create(480, 360);
        const outcome = await v.render(dataView({ model: { name: "Model", values: [MODEL_ID] } }));
        expect(outcome).toBe("finished");
        const [tile] = tiles(v.element);
        expect(tile.getAttribute("aria-label")).toMatch(/^Brass desk lamp.*, 3D model$/);
        expect(tile.querySelector(".tws-label")?.textContent).toMatch(/^Brass desk lamp/);
        await page.screenshot({ path: "out/live-model-id.png", element: v.element });
        v.destroy();
    });
});
