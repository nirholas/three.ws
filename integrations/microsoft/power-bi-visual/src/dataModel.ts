"use strict";

import powerbi from "powerbi-visuals-api";
import { format as formatValue } from "powerbi-visuals-utils-formattingutils/lib/valueFormatter";
import { ModelRef, parseModelRef } from "./modelRef";

import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import PrimitiveValue = powerbi.PrimitiveValue;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

/**
 * Maps the categorical data view onto one row per model.
 *
 * Roles (capabilities.json): category and model are groupings, colorBy and
 * scaleBy are single numeric measures, tooltips are any number of extra fields.
 */

export interface ModelRow {
    index: number;
    key: string;
    label: string | null;
    ref: ModelRef;
    colorValue: number | null;
    scaleValue: number | null;
    tooltipItems: VisualTooltipDataItem[];
    selectionId: ISelectionId;
    highlighted: boolean;
}

export type DataState =
    | { kind: "empty" }
    | { kind: "needsModel"; hasCategory: boolean }
    | { kind: "rows"; model: ModelData };

export interface ModelData {
    rows: ModelRow[];
    hasHighlights: boolean;
    colorRange: [number, number] | null;
    scaleMax: number | null;
    colorName: string | null;
    scaleName: string | null;
    truncated: boolean;
}

function findCategory(dataView: DataView, role: string): DataViewCategoryColumn | undefined {
    return dataView.categorical?.categories?.find((c) => c.source.roles?.[role]);
}

function findValues(dataView: DataView, role: string): DataViewValueColumn[] {
    const values = dataView.categorical?.values;
    if (!values) return [];
    const found: DataViewValueColumn[] = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles?.[role]) found.push(values[i]);
    }
    return found;
}

function toNumber(value: PrimitiveValue | undefined): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function display(value: PrimitiveValue | undefined, fmt: string | undefined): string {
    if (value === null || value === undefined) return "(Blank)";
    return formatValue(value, fmt);
}

function range(values: Array<number | null>): [number, number] | null {
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return [Math.min(...nums), Math.max(...nums)];
}

export function readDataView(dataView: DataView | undefined, host: IVisualHost): DataState {
    if (!dataView?.categorical) return { kind: "empty" };

    const categoryColumn = findCategory(dataView, "category");
    const modelColumn = findCategory(dataView, "model");
    if (!modelColumn) {
        return categoryColumn ? { kind: "needsModel", hasCategory: true } : { kind: "empty" };
    }

    const colorColumn = findValues(dataView, "colorBy")[0];
    const scaleColumn = findValues(dataView, "scaleBy")[0];
    const tooltipColumns = findValues(dataView, "tooltips");
    const highlightSources = [colorColumn, scaleColumn, ...tooltipColumns].filter(
        (c): c is DataViewValueColumn => Boolean(c?.highlights),
    );
    const hasHighlights = highlightSources.length > 0;

    const rows: ModelRow[] = modelColumn.values.map((rawModel, index) => {
        const builder = host.createSelectionIdBuilder();
        if (categoryColumn) builder.withCategory(categoryColumn, index);
        builder.withCategory(modelColumn, index);
        const selectionId = builder.createSelectionId();

        const ref = parseModelRef(rawModel);
        const categoryValue = categoryColumn?.values[index];
        const label = categoryColumn && categoryValue !== null && categoryValue !== undefined
            ? display(categoryValue, categoryColumn.source.format)
            : null;
        const colorValue = colorColumn ? toNumber(colorColumn.values[index]) : null;
        const scaleValue = scaleColumn ? toNumber(scaleColumn.values[index]) : null;

        const tooltipItems: VisualTooltipDataItem[] = [];
        if (categoryColumn) {
            tooltipItems.push({ displayName: categoryColumn.source.displayName, value: display(categoryValue, categoryColumn.source.format) });
        }
        if (colorColumn) {
            tooltipItems.push({ displayName: colorColumn.source.displayName, value: display(colorColumn.values[index], colorColumn.source.format) });
        }
        if (scaleColumn && scaleColumn !== colorColumn) {
            tooltipItems.push({ displayName: scaleColumn.source.displayName, value: display(scaleColumn.values[index], scaleColumn.source.format) });
        }
        for (const column of tooltipColumns) {
            tooltipItems.push({ displayName: column.source.displayName, value: display(column.values[index], column.source.format) });
        }

        const highlighted = hasHighlights
            ? highlightSources.some((c) => c.highlights?.[index] !== null && c.highlights?.[index] !== undefined)
            : false;

        return {
            index,
            key: selectionId.getKey() || `row-${index}`,
            label,
            ref,
            colorValue,
            scaleValue,
            tooltipItems,
            selectionId,
            highlighted,
        };
    });

    // Keys must be unique for tile reuse across updates, whatever the host's
    // selection id keys look like.
    const seen = new Map<string, number>();
    for (const row of rows) {
        const n = seen.get(row.key) ?? 0;
        seen.set(row.key, n + 1);
        if (n > 0) row.key = `${row.key}#${n}`;
    }

    const scaleValues = rows.map((r) => r.scaleValue).filter((v): v is number => v !== null).map(Math.abs);
    return {
        kind: "rows",
        model: {
            rows,
            hasHighlights,
            colorRange: colorColumn ? range(rows.map((r) => r.colorValue)) : null,
            scaleMax: scaleValues.length > 0 ? Math.max(...scaleValues) : null,
            colorName: colorColumn?.source.displayName ?? null,
            scaleName: scaleColumn?.source.displayName ?? null,
            truncated: Boolean(dataView.metadata?.segment),
        },
    };
}
