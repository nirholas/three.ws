"use strict";

import { el, icon } from "./dom";

/**
 * The landing page shown until a Model field is bound. It tells the report
 * author exactly which field goes in which well and what values work.
 */

export type LandingState = "empty" | "needsModel";

export function buildLanding(state: LandingState): HTMLElement {
    const modelStep = el(
        "li",
        state === "needsModel" ? "tws-step tws-step-next" : "tws-step",
        null,
        el("span", "tws-step-well", null, "Model"),
        el(
            "span",
            "tws-step-text",
            null,
            "Drag a text column holding a GLB URL on https://three.ws or a three.ws model id. This field is required.",
        ),
    );

    const optional = (well: string, text: string): HTMLLIElement =>
        el("li", "tws-step", null, el("span", "tws-step-well", null, well), el("span", "tws-step-text", null, text));

    return el(
        "section",
        "tws-landing",
        { role: "region", "aria-label": "How to use the three.ws 3D Models visual" },
        el("div", "tws-landing-mark", null, icon("cube")),
        el("h2", "tws-landing-title", null, state === "needsModel" ? "Add a Model field to show 3D models" : "Show 3D models from your data"),
        el(
            "p",
            "tws-landing-lead",
            null,
            "Each row becomes a 3D model. One row fills the visual; several rows form a grid or a turntable gallery.",
        ),
        el(
            "ol",
            "tws-steps",
            null,
            modelStep,
            optional("Category", "Optional. Names each model and lets a click cross-filter the rest of the report."),
            optional("Colour by", "Optional measure. Set Colour mode to Colour by measure to tint models along a two-colour ramp."),
            optional("Scale by", "Optional measure. Sizes models relative to the largest value."),
            optional("Tooltips", "Optional. Extra fields shown when hovering a model."),
        ),
        el(
            "p",
            "tws-landing-example",
            null,
            "Example values: ",
            el("code", null, null, "https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb"),
            " or ",
            el("code", null, null, "18656b0c-796d-4518-9e6e-07c6e22a2d29"),
        ),
    );
}
