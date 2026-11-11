"use strict";

import { ColorMode, LayoutMode } from "./settings";

/** Pure mappings from data to visual encodings and tile geometry. */

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Linear ramp between two colours; a flat range maps to the high colour. */
export function rampColor(value: number, [min, max]: [number, number], low: string, high: string): string {
    const t = max === min ? 1 : Math.min(1, Math.max(0, (value - min) / (max - min)));
    const a = hexToRgb(low);
    const b = hexToRgb(high);
    return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export interface TintInput {
    mode: ColorMode;
    value: number | null;
    range: [number, number] | null;
    low: string;
    high: string;
    tint: string;
}

/** The tint applied over a model's materials, or null to keep them as authored. */
export function tintFor(input: TintInput): string | null {
    if (input.mode === "single") return input.tint;
    if (input.mode === "measure" && input.value !== null && input.range) {
        return rampColor(input.value, input.range, input.low, input.high);
    }
    return null;
}

export const MIN_SCALE = 0.35;

/**
 * Relative size from the Scale by measure: the largest absolute value fills its
 * tile, zero and negatives get the minimum, and rows without a value keep full
 * size so a blank never reads as "small".
 */
export function scaleFor(value: number | null, max: number | null): number {
    if (value === null || max === null || max <= 0) return 1;
    const t = Math.max(0, value) / max;
    return MIN_SCALE + (1 - MIN_SCALE) * t;
}

export interface Rect { x: number; y: number; width: number; height: number }

export const GRID_LIMIT = 24;
export const MIN_TILE = 96;

/** Columns and rows that make tiles as large and as square as possible. */
export function gridShape(count: number, width: number, height: number): { cols: number; rows: number } {
    let best = { cols: 1, rows: Math.max(1, count), size: 0 };
    for (let cols = 1; cols <= Math.max(1, count); cols++) {
        const rows = Math.ceil(count / cols);
        const size = Math.min(width / cols, height / rows);
        if (size > best.size) best = { cols, rows, size };
    }
    return { cols: best.cols, rows: best.rows };
}

export function gridRects(count: number, width: number, height: number, gap = 8): Rect[] {
    if (count <= 0) return [];
    const { cols, rows } = gridShape(count, width, height);
    const w = (width - gap * (cols - 1)) / cols;
    const h = (height - gap * (rows - 1)) / rows;
    const rects: Rect[] = [];
    for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        rects.push({ x: c * (w + gap), y: r * (h + gap), width: w, height: h });
    }
    return rects;
}

/** Auto layout: a grid while every tile stays readable, a gallery beyond that. */
export function resolveLayout(mode: LayoutMode, count: number, width: number, height: number): "grid" | "gallery" {
    if (mode !== "auto") return count <= 1 ? "grid" : mode;
    if (count <= 1) return "grid";
    if (count > GRID_LIMIT) return "gallery";
    const { cols, rows } = gridShape(count, width, height);
    return Math.min(width / cols, height / rows) >= MIN_TILE ? "grid" : "gallery";
}
