import powerbi from "powerbi-visuals-api";
import { createVisualHost } from "powerbi-visuals-utils-testutils";
import { vi } from "vitest";

import { Visual } from "../src/visual";

import DataView = powerbi.DataView;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import PrimitiveValue = powerbi.PrimitiveValue;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;

/** A real, public GLB served by three.ws (2.3 MB, verified 200 with CORS). */
export const LIVE_GLB = "https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb";
/** Same CDN path shape with an id that has no file, so production answers 404. */
export const MISSING_GLB = "https://three.ws/cdn/forge/nvidia/00000000-0000-0000-0000-000000000000.glb";

export interface Column {
    name: string;
    values: PrimitiveValue[];
    format?: string;
    highlights?: PrimitiveValue[];
}

export interface Fields {
    category?: Column;
    model?: Column;
    colorBy?: Column;
    scaleBy?: Column;
    tooltips?: Column[];
    segment?: boolean;
}

function source(column: Column, role: string, index: number, isMeasure: boolean): powerbi.DataViewMetadataColumn {
    return {
        displayName: column.name,
        queryName: `Table.${column.name}`,
        roles: { [role]: true },
        index,
        format: column.format,
        isMeasure,
        type: isMeasure ? { numeric: true } : { text: true },
    } as powerbi.DataViewMetadataColumn;
}

/** Builds a categorical data view shaped the way the host sends it for capabilities.json. */
export function dataView(fields: Fields): DataView {
    const columns: powerbi.DataViewMetadataColumn[] = [];
    const categories: powerbi.DataViewCategoryColumn[] = [];
    const values: powerbi.DataViewValueColumn[] = [];
    let index = 0;
    for (const role of ["category", "model"] as const) {
        const column = fields[role];
        if (!column) continue;
        const meta = source(column, role, index++, false);
        columns.push(meta);
        categories.push({ source: meta, values: column.values, identity: [] });
    }
    const measures: Array<[string, Column]> = [];
    if (fields.colorBy) measures.push(["colorBy", fields.colorBy]);
    if (fields.scaleBy) measures.push(["scaleBy", fields.scaleBy]);
    for (const t of fields.tooltips ?? []) measures.push(["tooltips", t]);
    for (const [role, column] of measures) {
        const meta = source(column, role, index++, true);
        columns.push(meta);
        values.push({ source: meta, values: column.values, highlights: column.highlights } as powerbi.DataViewValueColumn);
    }
    const valueColumns = Object.assign(values, { grouped: () => [] }) as unknown as powerbi.DataViewValueColumns;
    return {
        metadata: { columns, segment: fields.segment ? {} : undefined },
        categorical: { categories: categories.length ? categories : undefined, values: values.length ? valueColumns : undefined },
    } as DataView;
}

export interface Mounted {
    visual: Visual;
    host: IVisualHost;
    element: HTMLElement;
    started: ReturnType<typeof vi.fn>;
    finished: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    update(view: DataView | undefined, width?: number, height?: number, objects?: powerbi.DataViewObjects): VisualUpdateOptions;
    /** Resolves with the outcome of the most recent update once the visual reports it. */
    rendered(): Promise<"finished" | "failed">;
    unmount(): void;
}

export function mount(options: { allowInteractions?: boolean; host?: (host: IVisualHost) => void } = {}): Mounted {
    const host = createVisualHost({ allowInteractions: options.allowInteractions ?? true });
    options.host?.(host);
    const element = document.createElement("div");
    element.style.cssText = "position:relative;width:640px;height:400px";
    document.body.appendChild(element);

    let settle: ((outcome: "finished" | "failed") => void) | null = null;
    let current: VisualUpdateOptions | null = null;
    const started = vi.fn();
    const finished = vi.fn((o: VisualUpdateOptions) => { if (o === current) settle?.("finished"); });
    const failed = vi.fn((o: VisualUpdateOptions) => { if (o === current) settle?.("failed"); });
    host.eventService.renderingStarted = started;
    host.eventService.renderingFinished = finished;
    host.eventService.renderingFailed = failed;

    const visual = new Visual({ element, host } as powerbi.extensibility.visual.VisualConstructorOptions);
    let done: Promise<"finished" | "failed"> = Promise.resolve("finished");

    return {
        visual,
        host,
        element,
        started,
        finished,
        failed,
        update(view, width = 640, height = 400, objects) {
            if (view && objects) view.metadata.objects = objects;
            const update = { viewport: { width, height }, dataViews: view ? [view] : [], type: 2 } as unknown as VisualUpdateOptions;
            current = update;
            done = new Promise((resolve) => { settle = resolve; });
            element.style.width = `${width}px`;
            element.style.height = `${height}px`;
            visual.update(update);
            return update;
        },
        rendered: () => done,
        unmount() {
            visual.destroy();
            element.remove();
        },
    };
}

export function tiles(element: HTMLElement): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>(".tws-tile"));
}

export function visibleTiles(element: HTMLElement): HTMLElement[] {
    return tiles(element).filter((t) => !t.hidden);
}

export async function settle(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
}
