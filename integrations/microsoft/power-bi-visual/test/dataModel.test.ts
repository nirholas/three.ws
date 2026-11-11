import { createVisualHost } from "powerbi-visuals-utils-testutils";
import { describe, expect, it } from "vitest";

import { readDataView } from "../src/dataModel";
import { dataView, LIVE_GLB } from "./helpers";

const ID = "18656b0c-796d-4518-9e6e-07c6e22a2d29";

function read(view: Parameters<typeof dataView>[0]) {
    return readDataView(dataView(view), createVisualHost({}));
}

describe("data role mapping", () => {
    it("reports an empty visual when nothing is bound", () => {
        expect(readDataView(undefined, createVisualHost({}))).toEqual({ kind: "empty" });
        expect(read({})).toEqual({ kind: "empty" });
    });

    it("asks for the Model role when only Category is bound", () => {
        expect(read({ category: { name: "Product", values: ["Lamp"] } })).toEqual({ kind: "needsModel", hasCategory: true });
    });

    it("maps Category, Model, Colour by, Scale by and Tooltips onto one row per model", () => {
        const state = read({
            category: { name: "Product", values: ["Lamp", "Robot", null] },
            model: { name: "Model", values: [ID, LIVE_GLB, "https://example.com/x.glb"] },
            colorBy: { name: "Sales", values: [10, 30, null], format: "#,0" },
            scaleBy: { name: "Units", values: [5, -20, 8] },
            tooltips: [{ name: "Region", values: ["North", "South", "East"] }],
        });
        expect(state.kind).toBe("rows");
        if (state.kind !== "rows") return;
        const { model } = state;
        expect(model.rows).toHaveLength(3);
        expect(model.rows.map((r) => r.label)).toEqual(["Lamp", "Robot", null]);
        expect(model.rows[0].ref).toEqual({ kind: "id", id: ID });
        expect(model.rows[1].ref).toEqual({ kind: "url", url: LIVE_GLB });
        expect(model.rows[2].ref.kind).toBe("invalid");
        expect(model.rows.map((r) => r.colorValue)).toEqual([10, 30, null]);
        expect(model.rows.map((r) => r.scaleValue)).toEqual([5, -20, 8]);
        expect(model.colorRange).toEqual([10, 30]);
        expect(model.scaleMax).toBe(20);
        expect(model.colorName).toBe("Sales");
        expect(model.scaleName).toBe("Units");
        expect(model.hasHighlights).toBe(false);
        expect(model.truncated).toBe(false);
        expect(model.rows[0].tooltipItems).toEqual([
            { displayName: "Product", value: "Lamp" },
            { displayName: "Sales", value: "10" },
            { displayName: "Units", value: "5" },
            { displayName: "Region", value: "North" },
        ]);
        expect(model.rows[2].tooltipItems[1]).toEqual({ displayName: "Sales", value: "(Blank)" });
    });

    it("gives every row a selection id and a unique key", () => {
        const state = read({ model: { name: "Model", values: [LIVE_GLB, LIVE_GLB, ID] } });
        if (state.kind !== "rows") throw new Error(`expected rows, got ${state.kind}`);
        const keys = state.model.rows.map((r) => r.key);
        expect(new Set(keys).size).toBe(3);
        for (const row of state.model.rows) expect(row.selectionId).toBeTruthy();
        expect(state.model.colorRange).toBeNull();
        expect(state.model.scaleMax).toBeNull();
    });

    it("marks highlighted rows when the report cross-highlights", () => {
        const state = read({
            model: { name: "Model", values: [ID, LIVE_GLB] },
            colorBy: { name: "Sales", values: [10, 30], highlights: [null, 30] },
        });
        if (state.kind !== "rows") throw new Error(`expected rows, got ${state.kind}`);
        expect(state.model.hasHighlights).toBe(true);
        expect(state.model.rows.map((r) => r.highlighted)).toEqual([false, true]);
    });

    it("flags a reduced data window so the visual can say only the first rows are shown", () => {
        const state = read({ model: { name: "Model", values: [ID] }, segment: true });
        if (state.kind !== "rows") throw new Error(`expected rows, got ${state.kind}`);
        expect(state.model.truncated).toBe(true);
    });
});
