import { MockILocalizationManager } from "powerbi-visuals-utils-testutils";
import { afterEach, describe, expect, it } from "vitest";

import resjson from "../stringResources/en-US/resources.resjson?raw";
import capabilities from "../capabilities.json";
import { gridRects, gridShape, rampColor, resolveLayout, scaleFor, tintFor, MIN_SCALE } from "../src/encoding";
import { describeLoadError } from "../src/loader";
import { fallbackTitle, parseModelRef, viewerUrlFor } from "../src/modelRef";
import { ModelLoadError, ModelResolver } from "../src/resolver";
import { toViewSettings, VisualFormattingSettingsModel } from "../src/settings";
import { setLocalizationManager, STRINGS, t } from "../src/strings";

describe("parseModelRef", () => {
    it("accepts a three.ws GLB URL and normalises the host", () => {
        expect(parseModelRef("https://www.three.ws/cdn/forge/anon/a.web.glb?v=2")).toEqual({
            kind: "url",
            url: "https://three.ws/cdn/forge/anon/a.web.glb?v=2",
        });
    });

    it("accepts a bare model id and a model page link as ids", () => {
        const id = "18656B0C-796D-4518-9E6E-07C6E22A2D29";
        expect(parseModelRef(id)).toEqual({ kind: "id", id: id.toLowerCase() });
        expect(parseModelRef(`https://three.ws/m/${id}/`)).toEqual({ kind: "id", id: id.toLowerCase() });
    });

    it("rejects hosts outside the WebAccess privilege, plain http, junk and blanks", () => {
        const blocked = parseModelRef("https://example.com/model.glb");
        expect(blocked.kind).toBe("invalid");
        expect(blocked.kind === "invalid" && blocked.reason).toContain("example.com is blocked");
        expect(parseModelRef("http://three.ws/a.glb")).toMatchObject({ kind: "invalid", reason: STRINGS.Err_NotHttps });
        expect(parseModelRef("not a model")).toMatchObject({ kind: "invalid", reason: STRINGS.Err_NotModel });
        expect(parseModelRef(null)).toMatchObject({ kind: "invalid", reason: STRINGS.Err_NoValue });
        expect(parseModelRef("   ")).toMatchObject({ kind: "invalid", reason: STRINGS.Err_NoValue });
    });

    it("builds viewer links and readable fallback titles", () => {
        expect(viewerUrlFor({ kind: "id", id: "abc" })).toBe("https://three.ws/m/abc");
        expect(viewerUrlFor({ kind: "url", url: "https://three.ws/x.glb" })).toBe("https://three.ws/app?src=https%3A%2F%2Fthree.ws%2Fx.glb");
        expect(viewerUrlFor({ kind: "invalid", reason: "x" })).toBeNull();
        expect(fallbackTitle({ kind: "url", url: "https://three.ws/cdn/forge/anon/desk%20lamp.web.glb" })).toBe("desk lamp");
        expect(fallbackTitle({ kind: "id", id: "18656b0c-796d-4518-9e6e-07c6e22a2d29" })).toBe("Model 18656b0c");
    });
});

describe("encodings", () => {
    it("ramps colours linearly and clamps outside the range", () => {
        expect(rampColor(0, [0, 10], "#000000", "#FFFFFF")).toBe("#000000");
        expect(rampColor(5, [0, 10], "#000000", "#FFFFFF")).toBe("#808080");
        expect(rampColor(50, [0, 10], "#000000", "#FFFFFF")).toBe("#FFFFFF");
        expect(rampColor(3, [3, 3], "#000000", "#FF0000")).toBe("#FF0000");
    });

    it("tints only in measure or single mode", () => {
        const base = { value: 5, range: [0, 10] as [number, number], low: "#000000", high: "#FFFFFF", tint: "#118DFF" };
        expect(tintFor({ ...base, mode: "original" })).toBeNull();
        expect(tintFor({ ...base, mode: "single" })).toBe("#118DFF");
        expect(tintFor({ ...base, mode: "measure" })).toBe("#808080");
        expect(tintFor({ ...base, mode: "measure", value: null })).toBeNull();
    });

    it("scales relative to the largest value and keeps blanks full size", () => {
        expect(scaleFor(10, 10)).toBe(1);
        expect(scaleFor(0, 10)).toBe(MIN_SCALE);
        expect(scaleFor(-4, 10)).toBe(MIN_SCALE);
        expect(scaleFor(null, 10)).toBe(1);
        expect(scaleFor(5, 10)).toBeCloseTo(MIN_SCALE + (1 - MIN_SCALE) * 0.5);
    });

    it("lays out square-ish grids that fill the viewport", () => {
        expect(gridShape(4, 400, 400)).toEqual({ cols: 2, rows: 2 });
        expect(gridShape(3, 900, 300)).toEqual({ cols: 3, rows: 1 });
        const rects = gridRects(3, 900, 300, 10);
        expect(rects).toHaveLength(3);
        expect(rects[2].x + rects[2].width).toBeCloseTo(900);
        expect(gridRects(0, 100, 100)).toEqual([]);
    });

    it("switches Auto to the gallery when tiles would be too small or too many", () => {
        expect(resolveLayout("auto", 1, 100, 100)).toBe("grid");
        expect(resolveLayout("auto", 4, 640, 400)).toBe("grid");
        expect(resolveLayout("auto", 30, 2000, 2000)).toBe("gallery");
        expect(resolveLayout("auto", 12, 300, 200)).toBe("gallery");
        expect(resolveLayout("gallery", 3, 640, 400)).toBe("gallery");
        expect(resolveLayout("grid", 40, 640, 400)).toBe("grid");
    });
});

describe("load errors", () => {
    it("explains HTTP failures from three.js file loading", () => {
        expect(describeLoadError({ response: { status: 404 } })).toBe(STRINGS.Err_FileNotFound);
        expect(describeLoadError({ response: { status: 403 } })).toBe("The model file is not public (HTTP 403).");
        expect(describeLoadError({ response: { status: 502 } })).toBe("The model file could not be downloaded (HTTP 502).");
        expect(describeLoadError(new TypeError("Failed to fetch"))).toBe(STRINGS.Err_Download);
        expect(describeLoadError(new Error("Unexpected token in JSON"))).toBe(STRINGS.Err_InvalidFile);
        expect(describeLoadError(new ModelLoadError("own message"))).toBe("own message");
    });

    it("rejects invalid refs and passes URLs through without a network call", async () => {
        const resolver = new ModelResolver();
        await expect(resolver.resolve({ kind: "invalid", reason: "bad row" })).rejects.toThrow("bad row");
        await expect(resolver.resolve({ kind: "url", url: "https://three.ws/a.glb" })).resolves.toEqual({ urls: ["https://three.ws/a.glb"], title: null });
    });
});

describe("strings and localization", () => {
    afterEach(() => setLocalizationManager(null));

    it("ships an en-US resource file identical to the string table", () => {
        expect(JSON.parse(resjson)).toEqual(STRINGS);
    });

    it("gives every capabilities.json key a string", () => {
        for (const role of capabilities.dataRoles) {
            expect(STRINGS).toHaveProperty(role.displayNameKey);
            expect(STRINGS).toHaveProperty(role.descriptionKey);
        }
    });

    it("uses host translations and falls back to English for missing keys", () => {
        setLocalizationManager(new MockILocalizationManager({ Ui_Retry: "Wiederholen" }));
        expect(t("Ui_Retry")).toBe("Wiederholen");
        expect(t("Ui_Truncated", 100)).toBe("Showing the first 100 rows");
        setLocalizationManager(null);
        expect(t("Err_HostNotAllowed", "https://three.ws", "evil.test")).toBe(
            "Power BI only lets this visual load models from https://three.ws. evil.test is blocked.",
        );
    });

    it("has no dash characters the house style bans", () => {
        for (const value of Object.values(STRINGS)) expect(value).not.toMatch(/[\u2013\u2014]/);
    });
});

describe("format pane", () => {
    it("defaults to studio lighting, auto layout, original materials and a transparent background", () => {
        const view = toViewSettings(new VisualFormattingSettingsModel());
        expect(view).toMatchObject({
            background: null,
            lighting: "studio",
            layout: "auto",
            autoRotate: true,
            rotationSpeed: 20,
            colorMode: "original",
            showLabels: true,
            labelSize: 12,
        });
    });

    it("clamps and validates values coming back from the report", () => {
        const model = new VisualFormattingSettingsModel();
        model.scene.rotationSpeed.value = 9999;
        model.scene.background.value = { value: "not-a-colour" };
        model.labels.fontSize.value = 2;
        const view = toViewSettings(model);
        expect(view.rotationSpeed).toBe(180);
        expect(view.background).toBeNull();
        expect(view.labelSize).toBe(8);
    });
});
