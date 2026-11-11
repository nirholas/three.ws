"use strict";

// Type-only so scripts/build-strings.mjs can load this file with Node's type stripping.
import type powerbi from "powerbi-visuals-api";

type ILocalizationManager = powerbi.extensibility.ILocalizationManager;

/**
 * Every string the visual shows, keyed the way Power BI localization expects.
 *
 * The English text here is the source of truth and the fallback. The same keys
 * and values live in stringResources/en-US/resources.resjson (a test keeps the
 * two identical), and translators add stringResources/<locale>/resources.resjson
 * files with the same keys. capabilities.json and the format pane reference the
 * Role_, Obj_ and Prop_ keys through displayNameKey and descriptionKey.
 *
 * Placeholders are {0}, {1}, ... and are filled by t().
 */
export const STRINGS = {
    Role_Category: "Category",
    Role_Category_Desc: "Label for each model, for example a product name or a site. Optional: without it the model's own name is used.",
    Role_Model: "Model",
    Role_Model_Desc: "A GLB URL on https://three.ws, a three.ws model link (three.ws/m/<id>) or a bare three.ws model id.",
    Role_ColorBy: "Colour by",
    Role_ColorBy_Desc: "Numeric measure mapped onto the low to high colour ramp in the Colours card.",
    Role_ScaleBy: "Scale by",
    Role_ScaleBy_Desc: "Numeric measure that sizes each model relative to the largest value.",
    Role_Tooltips: "Tooltips",
    Role_Tooltips_Desc: "Extra fields shown when hovering a model.",

    Obj_Scene: "Scene",
    Obj_Colors: "Colours",
    Obj_Labels: "Labels",
    Prop_Background: "Background",
    Prop_Background_Desc: "Leave empty for a transparent background that shows the report page.",
    Prop_Lighting: "Lighting",
    Prop_Lighting_Studio: "Studio",
    Prop_Lighting_Soft: "Soft daylight",
    Prop_Lighting_Dramatic: "Dramatic",
    Prop_Lighting_Flat: "Flat",
    Prop_Layout: "Layout",
    Prop_Layout_Desc: "Auto shows a grid for up to 24 models and a turntable gallery above that.",
    Prop_Layout_Auto: "Auto",
    Prop_Layout_Grid: "Grid",
    Prop_Layout_Gallery: "Turntable gallery",
    Prop_AutoRotate: "Auto-rotate",
    Prop_RotationSpeed: "Rotation speed (degrees per second)",
    Prop_ColorMode: "Colour mode",
    Prop_ColorMode_Original: "Original materials",
    Prop_ColorMode_Measure: "Colour by measure",
    Prop_ColorMode_Single: "Single tint",
    Prop_LowColor: "Low value colour",
    Prop_HighColor: "High value colour",
    Prop_TintColor: "Tint colour",
    Prop_ShowLabels: "Show labels",
    Prop_FontSize: "Text size",
    Prop_LabelColor: "Text colour",

    Landing_Region: "How to use the three.ws 3D Models visual",
    Landing_TitleEmpty: "Show 3D models from your data",
    Landing_TitleNeedsModel: "Add a Model field to show 3D models",
    Landing_Lead: "Each row becomes a 3D model. One row fills the visual; several rows form a grid or a turntable gallery.",
    Landing_ModelStep: "Drag a text column holding a GLB URL on https://three.ws or a three.ws model id. This field is required.",
    Landing_CategoryStep: "Optional. Names each model and lets a click cross-filter the rest of the report.",
    Landing_ColorStep: "Optional measure. Set Colour mode to Colour by measure to tint models along a two-colour ramp.",
    Landing_ScaleStep: "Optional measure. Sizes models relative to the largest value.",
    Landing_TooltipsStep: "Optional. Extra fields shown when hovering a model.",
    Landing_Examples: "Example values:",
    Landing_Or: "or",

    Ui_Models: "3D models",
    Ui_GalleryModels: "Gallery models",
    Ui_Previous: "Previous model",
    Ui_Next: "Next model",
    Ui_Retry: "Retry",
    Ui_Open: "Open in three.ws",
    Ui_OpenLabel: "Open this model in three.ws",
    Ui_Truncated: "Showing the first {0} rows",
    Ui_TileLoading: "{0}, loading",
    Ui_TileReady: "{0}, 3D model",
    Ui_TileError: "{0}, could not load: {1}",
    Ui_UnknownError: "unknown error",
    Ui_ModelFallback: "Model",
    Ui_ModelIdTitle: "Model {0}",

    Err_NoWebGL: "WebGL is not available in this browser, so 3D models cannot be drawn. Open the report in a current version of Edge, Chrome, Firefox or Safari.",
    Err_AdminBlocked: "Your Power BI administrator has turned off web access for custom visuals, so models from three.ws cannot load. Ask them to allow web access for certified and uncertified visuals, or for this visual.",
    Err_HostBlocked: "This Power BI host does not allow custom visuals to download files, so models from three.ws cannot load here. Open the report in Power BI Service or Power BI Desktop.",
    Err_NoValue: "This row has no model value.",
    Err_NotModel: "Not a GLB URL or a three.ws model id.",
    Err_NotHttps: "Model URLs must use https://.",
    Err_HostNotAllowed: "Power BI only lets this visual load models from {0}. {1} is blocked.",
    Err_LookupUnreachable: "Could not reach three.ws to look up this model id. Check that web access is allowed for this visual.",
    Err_LookupNotFound: "No public three.ws model has the id {0}.",
    Err_LookupFailed: "three.ws could not look up this model (HTTP {0}). Try again shortly.",
    Err_NoGlb: "Model {0} has no downloadable GLB yet.",
    Err_StoredElsewhere: "Model {0} is stored outside {1}, which Power BI blocks for this visual.",
    Err_FileNotFound: "The model file was not found (404). Check the URL in this row.",
    Err_FileNotPublic: "The model file is not public (HTTP {0}).",
    Err_FileHttp: "The model file could not be downloaded (HTTP {0}).",
    Err_Download: "Could not download the model file. Check that web access is allowed for this visual.",
    Err_InvalidFile: "The file is not a valid GLB or glTF model.",
    Err_Display: "The model could not be displayed: {0}",
    Err_Draco: "This model uses Draco compression, and the decoder could not start here ({0}).",
} as const;

export type StringKey = keyof typeof STRINGS;

let manager: ILocalizationManager | null = null;

/** Called once per visual instance with the host's localization manager. */
export function setLocalizationManager(next: ILocalizationManager | null | undefined): void {
    manager = next ?? null;
}

/**
 * The localized string for a key, with {n} placeholders filled. Hosts return
 * the key itself (or nothing) for a missing translation, and then the English
 * text is used.
 */
export function t(key: StringKey, ...args: Array<string | number>): string {
    const localized = manager?.getDisplayName(key);
    const template = localized && localized !== key ? localized : STRINGS[key];
    return template.replace(/\{(\d+)\}/g, (match, index: string) => {
        const value = args[Number(index)];
        return value === undefined ? match : String(value);
    });
}

/** A localization manager view that always resolves, for the format pane service. */
export const localizer: ILocalizationManager = {
    getDisplayName: (key: string) => (key in STRINGS ? t(key as StringKey) : manager?.getDisplayName(key) ?? key),
};
