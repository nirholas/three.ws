"use strict";

/**
 * Element construction without innerHTML. Certified-visual rules forbid
 * innerHTML and every string here can come from report data, so text is only
 * ever assigned through textContent.
 */

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string | null,
    attrs?: Attrs | null,
    ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
        for (const [name, value] of Object.entries(attrs)) {
            if (value === null || value === undefined || value === false) continue;
            node.setAttribute(name, value === true ? "" : String(value));
        }
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
}

export function clear(node: Element): void {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/** Simple inline icons, built as SVG nodes. */
export function icon(name: "alert" | "open" | "prev" | "next" | "retry" | "cube"): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "tws-icon");
    const paths: Record<typeof name, string[]> = {
        alert: ["M12 3 2 21h20L12 3z", "M12 10v5", "M12 18h.01"],
        open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
        prev: ["M15 5l-7 7 7 7"],
        next: ["M9 5l7 7-7 7"],
        retry: ["M4 12a8 8 0 0 1 14-5.3L20 9", "M20 4v5h-5", "M20 12a8 8 0 0 1-14 5.3L4 15", "M4 20v-5h5"],
        cube: ["M12 2 3 7v10l9 5 9-5V7l-9-5z", "M3 7l9 5 9-5", "M12 12v10"],
    };
    for (const d of paths[name]) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}
