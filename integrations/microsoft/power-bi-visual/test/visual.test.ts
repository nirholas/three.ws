import powerbi from "powerbi-visuals-api";
import { afterEach, describe, expect, it } from "vitest";

import { STRINGS } from "../src/strings";
import { dataView, LIVE_GLB, MISSING_GLB, mount, Mounted, settle, tiles, visibleTiles } from "./helpers";

// Hosts outside the WebAccess privilege fail inside the visual without any
// network request, which keeps selection and layout tests fast and offline.
const blocked = (n: number) => `https://example.com/model-${n}.glb`;

let mounted: Mounted | null = null;
function open(options?: Parameters<typeof mount>[0]): Mounted {
    mounted = mount(options);
    return mounted;
}
afterEach(() => {
    mounted?.unmount();
    mounted = null;
});

function rows(count: number, extra: Partial<Parameters<typeof dataView>[0]> = {}) {
    return dataView({
        category: { name: "Product", values: Array.from({ length: count }, (_, i) => `Item ${i + 1}`) },
        model: { name: "Model", values: Array.from({ length: count }, (_, i) => blocked(i)) },
        ...extra,
    });
}

async function click(target: HTMLElement, init: MouseEventInit = {}): Promise<void> {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    await settle();
}

describe("landing page", () => {
    it("shows the getting started page when no fields are bound and reports the render as finished", async () => {
        const v = open();
        const options = v.update(undefined);
        expect(await v.rendered()).toBe("finished");
        expect(v.started).toHaveBeenCalledWith(options);
        expect(v.finished).toHaveBeenCalledWith(options);
        expect(v.failed).not.toHaveBeenCalled();
        const landing = v.element.querySelector(".tws-landing");
        expect(landing).not.toBeNull();
        expect(landing?.querySelector(".tws-landing-title")?.textContent).toBe(STRINGS.Landing_TitleEmpty);
        expect(landing?.querySelector(".tws-step-next")).toBeNull();
        expect(tiles(v.element)).toHaveLength(0);
    });

    it("points at the Model well when only Category is bound", async () => {
        const v = open();
        v.update(dataView({ category: { name: "Product", values: ["Lamp", "Robot"] } }));
        expect(await v.rendered()).toBe("finished");
        expect(v.element.querySelector(".tws-landing-title")?.textContent).toBe(STRINGS.Landing_TitleNeedsModel);
        expect(v.element.querySelector(".tws-step-next .tws-step-well")?.textContent).toBe(STRINGS.Role_Model);
    });

    it("replaces the landing page with tiles once a Model field arrives", async () => {
        const v = open();
        v.update(undefined);
        await v.rendered();
        v.update(rows(2));
        await v.rendered();
        expect((v.element.querySelector(".tws-landing-host") as HTMLElement).hidden).toBe(true);
        expect(v.element.querySelector(".tws-landing")).toBeNull();
        expect(tiles(v.element)).toHaveLength(2);
    });
});

describe("per-tile errors", () => {
    it("explains a blocked host on that tile only, without a Retry button", async () => {
        const v = open();
        v.update(rows(3));
        expect(await v.rendered()).toBe("finished");
        const [first] = tiles(v.element);
        expect(first.classList.contains("tws-is-error")).toBe(true);
        expect(first.querySelector(".tws-error-text")?.textContent).toBe(
            "Power BI only lets this visual load models from https://three.ws. example.com is blocked.",
        );
        expect((first.querySelector(".tws-error .tws-button") as HTMLElement).hidden).toBe(true);
        expect(first.getAttribute("aria-label")).toContain("could not load");
    });

    it("shows a 404 from the real three.ws CDN on the failing tile with Retry, while the healthy tile renders", async () => {
        const v = open();
        v.update(dataView({
            category: { name: "Product", values: ["Missing", "Live"] },
            model: { name: "Model", values: [MISSING_GLB, LIVE_GLB] },
        }));
        expect(await v.rendered()).toBe("finished");
        const [missing, live] = tiles(v.element);
        expect(missing.querySelector(".tws-error-text")?.textContent).toBe(STRINGS.Err_FileNotFound);
        const retry = missing.querySelector(".tws-error .tws-button") as HTMLButtonElement;
        expect(retry.hidden).toBe(false);
        expect(live.classList.contains("tws-is-error")).toBe(false);
        expect(live.classList.contains("tws-is-loading")).toBe(false);
        expect(live.getAttribute("aria-label")).toBe("Live, 3D model");
        expect(v.failed).not.toHaveBeenCalled();

        retry.click();
        expect(missing.classList.contains("tws-is-loading")).toBe(true);
        await expect.poll(() => missing.classList.contains("tws-is-error"), { timeout: 30_000 }).toBe(true);
    });

    it("tells the reader when an administrator has blocked web access", async () => {
        const v = open({
            host: (host) => {
                host.webAccessService.webAccessStatus = (() => Promise.resolve(3)) as unknown as powerbi.extensibility.IWebAccessService["webAccessStatus"];
            },
        });
        v.update(dataView({ model: { name: "Model", values: [LIVE_GLB] } }));
        expect(await v.rendered()).toBe("finished");
        const message = v.element.querySelector(".tws-message") as HTMLElement;
        expect(message.hidden).toBe(false);
        expect(message.textContent).toBe(STRINGS.Err_AdminBlocked);
        expect((v.element.querySelector(".tws-stage") as HTMLElement).hidden).toBe(true);
    });
});

describe("selection", () => {
    it("selects on click, adds with Ctrl, clears on the background and dims everything else", async () => {
        const v = open();
        v.update(rows(3));
        await v.rendered();
        const manager = (v.visual as unknown as { selectionManager: powerbi.extensibility.ISelectionManager }).selectionManager;
        const [a, b, c] = tiles(v.element);

        await click(a);
        expect(manager.getSelectionIds()).toHaveLength(1);
        expect(a.classList.contains("tws-selected")).toBe(true);
        expect(a.getAttribute("aria-selected")).toBe("true");
        expect(b.classList.contains("tws-dimmed")).toBe(true);
        expect(c.classList.contains("tws-dimmed")).toBe(true);

        await click(b, { ctrlKey: true });
        expect(manager.getSelectionIds()).toHaveLength(2);
        expect(b.classList.contains("tws-selected")).toBe(true);
        expect(c.classList.contains("tws-dimmed")).toBe(true);

        await click(b, { ctrlKey: true });
        expect(manager.getSelectionIds()).toHaveLength(1);
        expect(b.classList.contains("tws-dimmed")).toBe(true);

        await click(v.element.querySelector(".tws-stage") as HTMLElement);
        expect(manager.getSelectionIds()).toHaveLength(0);
        for (const tile of [a, b, c]) {
            expect(tile.classList.contains("tws-selected")).toBe(false);
            expect(tile.classList.contains("tws-dimmed")).toBe(false);
        }
    });

    it("selects from the keyboard with Enter", async () => {
        const v = open();
        v.update(rows(2));
        await v.rendered();
        const [, second] = tiles(v.element);
        second.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await settle();
        expect(second.classList.contains("tws-selected")).toBe(true);
    });

    it("reflects selections made elsewhere in the report", async () => {
        const v = open();
        v.update(rows(3));
        await v.rendered();
        const manager = (v.visual as unknown as { selectionManager: { simutateSelection(ids: unknown[]): void } }).selectionManager;
        const ids = (v.visual as unknown as { data: { rows: Array<{ selectionId: unknown }> } }).data.rows.map((r) => r.selectionId);
        manager.simutateSelection([ids[2]]);
        const [a, b, c] = tiles(v.element);
        expect(c.classList.contains("tws-selected")).toBe(true);
        expect(a.classList.contains("tws-dimmed")).toBe(true);
        expect(b.classList.contains("tws-dimmed")).toBe(true);
    });

    it("dims rows the report does not highlight", async () => {
        const v = open();
        v.update(rows(3, { colorBy: { name: "Sales", values: [1, 2, 3], highlights: [null, 2, null] } }));
        await v.rendered();
        const [a, b, c] = tiles(v.element);
        expect(a.classList.contains("tws-dimmed")).toBe(true);
        expect(b.classList.contains("tws-dimmed")).toBe(false);
        expect(c.classList.contains("tws-dimmed")).toBe(true);
    });

    it("ignores clicks where the host disallows interactions", async () => {
        const v = open({ allowInteractions: false });
        v.update(rows(2));
        await v.rendered();
        const [a] = tiles(v.element);
        await click(a);
        expect(a.classList.contains("tws-selected")).toBe(false);
    });
});

describe("layout, events and accessibility", () => {
    it("switches to the turntable gallery above 24 rows and loads only the models in view", async () => {
        const v = open();
        v.update(rows(30));
        expect(await v.rendered()).toBe("finished");
        const strip = v.element.querySelector(".tws-strip") as HTMLElement;
        expect(strip.hidden).toBe(false);
        expect(strip.querySelectorAll(".tws-chip")).toHaveLength(30);
        expect(visibleTiles(v.element)).toHaveLength(1);
        const loaded = tiles(v.element).filter((t) => t.classList.contains("tws-is-error"));
        expect(loaded.length).toBeLessThanOrEqual(3);

        const next = strip.querySelectorAll<HTMLButtonElement>(".tws-nav")[1];
        next.click();
        await settle();
        const [shown] = visibleTiles(v.element);
        expect(shown).toBe(tiles(v.element)[1]);
        expect(strip.querySelector('[aria-current="true"]')?.textContent).toContain("Item 2");
    });

    it("notes when Power BI reduced the data to the first rows", async () => {
        const v = open();
        v.update(dataView({ model: { name: "Model", values: [blocked(1)] }, segment: true }));
        await v.rendered();
        const note = v.element.querySelector(".tws-note") as HTMLElement;
        expect(note.hidden).toBe(false);
        expect(note.textContent).toBe("Showing the first 1 rows");
    });

    it("finishes a superseded render before starting the next one, and keeps tiles across a resize", async () => {
        const v = open();
        const first = v.update(rows(4));
        const second = v.update(rows(4), 320, 240);
        expect(v.finished).toHaveBeenCalledWith(first);
        expect(await v.rendered()).toBe("finished");
        expect(v.finished).toHaveBeenCalledWith(second);
        expect(v.started).toHaveBeenCalledTimes(2);
        const canvas = v.element.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.style.width).toBe("320px");
        expect(canvas.width).toBe(Math.round(320 * Math.min(window.devicePixelRatio || 1, 2)));
        expect(tiles(v.element)).toHaveLength(4);
    });

    it("adopts the high-contrast palette for background, text and focus colours", async () => {
        const v = open({
            host: (host) => {
                const palette = host.colorPalette as powerbi.extensibility.ISandboxExtendedColorPalette;
                Object.assign(palette, {
                    isHighContrast: true,
                    foreground: { value: "#FFFF00" },
                    background: { value: "#000000" },
                    foregroundSelected: { value: "#00FFFF" },
                });
            },
        });
        v.update(rows(2, { colorBy: { name: "Sales", values: [1, 2] } }), 640, 400, { colors: { mode: "measure" } });
        await v.rendered();
        expect(v.element.classList.contains("tws-hc")).toBe(true);
        expect(v.element.style.getPropertyValue("--tws-hc-fg")).toBe("#FFFF00");
        expect(v.element.style.getPropertyValue("--tws-hc-bg")).toBe("#000000");
        expect(v.element.style.getPropertyValue("--tws-hc-select")).toBe("#00FFFF");
        const settings = (v.visual as unknown as { settings: { colorMode: string; background: string; labelColor: string } }).settings;
        expect(settings).toMatchObject({ colorMode: "original", background: "#000000", labelColor: "#FFFF00" });
    });

    it("builds a localized format pane with three cards", () => {
        const v = open();
        v.update(rows(1));
        const model = v.visual.getFormattingModel();
        expect(model.cards.map((c) => (c as { displayName: string }).displayName)).toEqual([
            STRINGS.Obj_Scene,
            STRINGS.Obj_Colors,
            STRINGS.Obj_Labels,
        ]);
    });
});

describe("hidden parts stay hidden", () => {
    it("never paints an element the visual has hidden, whatever display its styles give it", async () => {
        const v = open();
        v.update(dataView({
            category: { name: "Product", values: ["Live", "Blocked"] },
            model: { name: "Model", values: [LIVE_GLB, blocked(1)] },
        }));
        expect(await v.rendered()).toBe("finished");
        const hidden = Array.from(v.element.querySelectorAll<HTMLElement>("[hidden]"));
        const [live, failed] = tiles(v.element);
        expect(hidden).toContain(live.querySelector(".tws-skeleton"));
        expect(hidden).toContain(live.querySelector(".tws-error"));
        expect(hidden).toContain(failed.querySelector(".tws-error .tws-button"));
        for (const element of hidden) {
            expect(getComputedStyle(element).display, element.className).toBe("none");
        }
    });
});

describe("real three.ws models", () => {
    it("downloads, decodes and draws a production GLB, then reports the render finished", async () => {
        const v = open();
        v.update(dataView({ category: { name: "Product", values: ["Robot"] }, model: { name: "Model", values: [LIVE_GLB] } }));
        expect(await v.rendered()).toBe("finished");
        const [tile] = tiles(v.element);
        expect(tile.classList.contains("tws-is-error")).toBe(false);
        expect(tile.getAttribute("aria-label")).toBe("Robot, 3D model");
        expect((tile.querySelector(".tws-open") as HTMLElement).hidden).toBe(false);

        const canvas = v.element.querySelector("canvas") as HTMLCanvasElement;
        const probe = document.createElement("canvas");
        probe.width = canvas.width;
        probe.height = canvas.height;
        const ctx = probe.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data;
        let painted = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted++;
        expect(painted).toBeGreaterThan(probe.width * probe.height * 0.02);
    });
});
