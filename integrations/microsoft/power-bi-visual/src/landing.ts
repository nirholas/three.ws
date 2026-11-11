"use strict";

import { el, icon } from "./dom";
import { t } from "./strings";

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
        el("span", "tws-step-well", null, t("Role_Model")),
        el(
            "span",
            "tws-step-text",
            null,
            t("Landing_ModelStep"),
        ),
    );

    const optional = (well: string, text: string): HTMLLIElement =>
        el("li", "tws-step", null, el("span", "tws-step-well", null, well), el("span", "tws-step-text", null, text));

    return el(
        "section",
        "tws-landing",
        { role: "region", "aria-label": t("Landing_Region") },
        el("div", "tws-landing-mark", null, icon("cube")),
        el("h2", "tws-landing-title", null, t(state === "needsModel" ? "Landing_TitleNeedsModel" : "Landing_TitleEmpty")),
        el(
            "p",
            "tws-landing-lead",
            null,
            t("Landing_Lead"),
        ),
        el(
            "ol",
            "tws-steps",
            null,
            modelStep,
            optional(t("Role_Category"), t("Landing_CategoryStep")),
            optional(t("Role_ColorBy"), t("Landing_ColorStep")),
            optional(t("Role_ScaleBy"), t("Landing_ScaleStep")),
            optional(t("Role_Tooltips"), t("Landing_TooltipsStep")),
        ),
        el(
            "p",
            "tws-landing-example",
            null,
            `${t("Landing_Examples")} `,
            el("code", null, null, "https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb"),
            ` ${t("Landing_Or")} `,
            el("code", null, null, "18656b0c-796d-4518-9e6e-07c6e22a2d29"),
        ),
    );
}
