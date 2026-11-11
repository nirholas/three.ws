"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import IEnumMember = powerbi.IEnumMember;
import ValidatorType = powerbi.visuals.ValidatorType;

// ValidatorType is an ambient const enum. pbiviz inlines it, but per-file
// transpilers (the test runner) cannot, so the two members used here are
// spelled as typed constants with the values the API declares.
const MIN = 0 as ValidatorType.Min;
const MAX = 1 as ValidatorType.Max;

/** Format pane model. Object and property names match capabilities.json. */

export type LightingPreset = "studio" | "soft" | "dramatic" | "flat";
export type LayoutMode = "auto" | "grid" | "gallery";
export type ColorMode = "original" | "measure" | "single";

// displayNameKey is read by the formatting service's localizer; the API's
// IEnumMember type does not declare it.
type LocalizedEnumMember = IEnumMember & { displayNameKey: string };

const lightingItems: LocalizedEnumMember[] = [
    { value: "studio", displayName: "Studio", displayNameKey: "Prop_Lighting_Studio" },
    { value: "soft", displayName: "Soft daylight", displayNameKey: "Prop_Lighting_Soft" },
    { value: "dramatic", displayName: "Dramatic", displayNameKey: "Prop_Lighting_Dramatic" },
    { value: "flat", displayName: "Flat", displayNameKey: "Prop_Lighting_Flat" },
];

const layoutItems: LocalizedEnumMember[] = [
    { value: "auto", displayName: "Auto", displayNameKey: "Prop_Layout_Auto" },
    { value: "grid", displayName: "Grid", displayNameKey: "Prop_Layout_Grid" },
    { value: "gallery", displayName: "Turntable gallery", displayNameKey: "Prop_Layout_Gallery" },
];

const colorModeItems: LocalizedEnumMember[] = [
    { value: "original", displayName: "Original materials", displayNameKey: "Prop_ColorMode_Original" },
    { value: "measure", displayName: "Colour by measure", displayNameKey: "Prop_ColorMode_Measure" },
    { value: "single", displayName: "Single tint", displayNameKey: "Prop_ColorMode_Single" },
];

class SceneCard extends formattingSettings.SimpleCard {
    background = new formattingSettings.ColorPicker({
        name: "background",
        displayName: "Background",
        displayNameKey: "Prop_Background",
        description: "Leave empty for a transparent background that shows the report page.",
        descriptionKey: "Prop_Background_Desc",
        value: { value: "" },
    });

    lighting = new formattingSettings.ItemDropdown({
        name: "lighting",
        displayName: "Lighting",
        displayNameKey: "Prop_Lighting",
        items: lightingItems,
        value: lightingItems[0],
    });

    layout = new formattingSettings.ItemDropdown({
        name: "layout",
        displayName: "Layout",
        displayNameKey: "Prop_Layout",
        description: "Auto shows a grid for up to 24 models and a turntable gallery above that.",
        descriptionKey: "Prop_Layout_Desc",
        items: layoutItems,
        value: layoutItems[0],
    });

    autoRotate = new formattingSettings.ToggleSwitch({
        name: "autoRotate",
        displayName: "Auto-rotate",
        displayNameKey: "Prop_AutoRotate",
        value: true,
    });

    rotationSpeed = new formattingSettings.NumUpDown({
        name: "rotationSpeed",
        displayName: "Rotation speed (degrees per second)",
        displayNameKey: "Prop_RotationSpeed",
        value: 20,
        options: {
            minValue: { type: MIN, value: 1 },
            maxValue: { type: MAX, value: 180 },
        },
    });

    name = "scene";
    displayName = "Scene";
    displayNameKey = "Obj_Scene";
    slices = [this.background, this.lighting, this.layout, this.autoRotate, this.rotationSpeed];
}

class ColorsCard extends formattingSettings.SimpleCard {
    mode = new formattingSettings.ItemDropdown({
        name: "mode",
        displayName: "Colour mode",
        displayNameKey: "Prop_ColorMode",
        items: colorModeItems,
        value: colorModeItems[0],
    });

    lowColor = new formattingSettings.ColorPicker({
        name: "lowColor",
        displayName: "Low value colour",
        displayNameKey: "Prop_LowColor",
        value: { value: "#2B6CB0" },
    });

    highColor = new formattingSettings.ColorPicker({
        name: "highColor",
        displayName: "High value colour",
        displayNameKey: "Prop_HighColor",
        value: { value: "#E53E3E" },
    });

    tintColor = new formattingSettings.ColorPicker({
        name: "tintColor",
        displayName: "Tint colour",
        displayNameKey: "Prop_TintColor",
        value: { value: "#118DFF" },
    });

    name = "colors";
    displayName = "Colours";
    displayNameKey = "Obj_Colors";
    slices = [this.mode, this.lowColor, this.highColor, this.tintColor];
}

class LabelsCard extends formattingSettings.SimpleCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show labels",
        displayNameKey: "Prop_ShowLabels",
        value: true,
    });

    topLevelSlice = this.show;

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        displayNameKey: "Prop_FontSize",
        value: 12,
        options: {
            minValue: { type: MIN, value: 8 },
            maxValue: { type: MAX, value: 32 },
        },
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Text colour",
        displayNameKey: "Prop_LabelColor",
        value: { value: "#252423" },
    });

    name = "labels";
    displayName = "Labels";
    displayNameKey = "Obj_Labels";
    slices = [this.fontSize, this.color];
}

export class VisualFormattingSettingsModel extends formattingSettings.Model {
    scene = new SceneCard();
    colors = new ColorsCard();
    labels = new LabelsCard();
    cards = [this.scene, this.colors, this.labels];
}

/** Plain, validated view of the format pane that the rest of the visual reads. */
export interface ViewSettings {
    background: string | null;
    lighting: LightingPreset;
    layout: LayoutMode;
    autoRotate: boolean;
    rotationSpeed: number;
    colorMode: ColorMode;
    lowColor: string;
    highColor: string;
    tintColor: string;
    showLabels: boolean;
    labelSize: number;
    labelColor: string;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

const HEX = /^#[0-9a-f]{6}$/i;

function colorOr(value: string | undefined, fallback: string): string {
    return value && HEX.test(value) ? value : fallback;
}

export function toViewSettings(model: VisualFormattingSettingsModel): ViewSettings {
    const bg = model.scene.background.value?.value;
    return {
        background: bg && HEX.test(bg) ? bg : null,
        lighting: pick(model.scene.lighting.value?.value, ["studio", "soft", "dramatic", "flat"] as const, "studio"),
        layout: pick(model.scene.layout.value?.value, ["auto", "grid", "gallery"] as const, "auto"),
        autoRotate: model.scene.autoRotate.value !== false,
        rotationSpeed: clamp(Number(model.scene.rotationSpeed.value) || 20, 1, 180),
        colorMode: pick(model.colors.mode.value?.value, ["original", "measure", "single"] as const, "original"),
        lowColor: colorOr(model.colors.lowColor.value?.value, "#2B6CB0"),
        highColor: colorOr(model.colors.highColor.value?.value, "#E53E3E"),
        tintColor: colorOr(model.colors.tintColor.value?.value, "#118DFF"),
        showLabels: model.labels.show.value !== false,
        labelSize: clamp(Number(model.labels.fontSize.value) || 12, 8, 32),
        labelColor: colorOr(model.labels.color.value?.value, "#252423"),
    };
}
