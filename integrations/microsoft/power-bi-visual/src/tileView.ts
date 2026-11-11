"use strict";

import { el, icon } from "./dom";
import { Rect } from "./encoding";
import { ModelRow } from "./dataModel";
import { fallbackTitle, viewerUrlFor } from "./modelRef";

/**
 * The DOM half of one model tile. The model itself is drawn on the shared
 * canvas underneath; this element sits over the same rectangle and carries the
 * label, the loading skeleton, the per-tile error, keyboard focus and all
 * pointer input.
 */

export type TileStatus = "loading" | "ready" | "error";

export interface TileHandlers {
    select(tile: Tile, event: MouseEvent | KeyboardEvent): void;
    contextMenu(tile: Tile, event: MouseEvent): void;
    tooltip(tile: Tile, event: PointerEvent | null): void;
    orbit(tile: Tile, dx: number, dy: number): void;
    retry(tile: Tile): void;
    open(tile: Tile): void;
    navigate(tile: Tile, event: KeyboardEvent): void;
}

const DRAG_THRESHOLD = 4;

export class Tile {
    readonly element: HTMLDivElement;
    row: ModelRow;
    status: TileStatus = "loading";
    errorMessage: string | null = null;
    resolvedTitle: string | null = null;
    /** Bumped whenever a load starts, so a stale load cannot overwrite a newer one. */
    loadToken = 0;
    /** Settles when the current load attempt has either drawn or failed. */
    settled: Promise<void> = Promise.resolve();
    selected = false;
    dimmed = false;

    private readonly label: HTMLDivElement;
    private readonly skeleton: HTMLDivElement;
    private readonly errorBox: HTMLDivElement;
    private readonly errorText: HTMLParagraphElement;
    private readonly retryButton: HTMLButtonElement;
    private readonly openButton: HTMLButtonElement;
    private pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
    private suppressClick = false;

    constructor(row: ModelRow, private readonly handlers: TileHandlers) {
        this.row = row;
        this.label = el("div", "tws-label", { "aria-hidden": "true" });
        this.skeleton = el("div", "tws-skeleton", { "aria-hidden": "true" }, el("span", "tws-skeleton-shape"));
        this.errorText = el("p", "tws-error-text");
        this.retryButton = el("button", "tws-button", { type: "button" }, icon("retry"), el("span", null, null, "Retry"));
        this.errorBox = el(
            "div",
            "tws-error",
            { role: "alert" },
            el("span", "tws-error-icon", null, icon("alert")),
            this.errorText,
            this.retryButton,
        );
        this.openButton = el("button", "tws-open", { type: "button", title: "Open in three.ws", "aria-label": "Open this model in three.ws" }, icon("open"));
        this.element = el("div", "tws-tile", { role: "option", tabindex: 0 }, this.skeleton, this.errorBox, this.label, this.openButton);
        this.errorBox.hidden = true;

        this.retryButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.handlers.retry(this);
        });
        this.openButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.handlers.open(this);
        });
        this.openButton.addEventListener("pointerdown", (event) => event.stopPropagation());
        this.retryButton.addEventListener("pointerdown", (event) => event.stopPropagation());

        this.element.addEventListener("click", (event) => {
            event.stopPropagation();
            if (this.suppressClick) {
                this.suppressClick = false;
                return;
            }
            this.handlers.select(this, event);
        });
        this.element.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.handlers.contextMenu(this, event);
        });
        this.element.addEventListener("keydown", (event) => {
            if (event.target !== this.element) return;
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.handlers.select(this, event);
            } else if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                this.handlers.navigate(this, event);
            }
        });
        this.element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        });
        this.element.addEventListener("pointermove", (event) => {
            const p = this.pointer;
            if (p && p.id === event.pointerId && (event.buttons & 1) === 1) {
                const dx = event.clientX - p.x;
                const dy = event.clientY - p.y;
                if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                if (!p.moved) {
                    p.moved = true;
                    this.element.setPointerCapture(event.pointerId);
                    this.element.classList.add("tws-dragging");
                    this.handlers.tooltip(this, null);
                }
                this.handlers.orbit(this, dx, dy);
                p.x = event.clientX;
                p.y = event.clientY;
                return;
            }
            this.handlers.tooltip(this, event);
        });
        const endDrag = (event: PointerEvent): void => {
            const p = this.pointer;
            if (!p || p.id !== event.pointerId) return;
            if (p.moved) {
                this.suppressClick = true;
                this.element.classList.remove("tws-dragging");
                if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
            }
            this.pointer = null;
        };
        this.element.addEventListener("pointerup", endDrag);
        this.element.addEventListener("pointercancel", endDrag);
        this.element.addEventListener("pointerleave", () => {
            if (!this.pointer) this.handlers.tooltip(this, null);
        });
    }

    get title(): string {
        return this.row.label ?? this.resolvedTitle ?? fallbackTitle(this.row.ref);
    }

    get viewerUrl(): string | null {
        return viewerUrlFor(this.row.ref);
    }

    setRect(rect: Rect): void {
        const s = this.element.style;
        s.left = `${rect.x}px`;
        s.top = `${rect.y}px`;
        s.width = `${rect.width}px`;
        s.height = `${rect.height}px`;
        this.element.classList.toggle("tws-compact", rect.width < 140 || rect.height < 110);
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible;
    }

    setStatus(status: TileStatus, message: string | null = null): void {
        this.status = status;
        this.errorMessage = message;
        this.skeleton.hidden = status !== "loading";
        this.errorBox.hidden = status !== "error";
        this.errorText.textContent = message ?? "";
        // A row whose value can never load (a blocked host, an empty cell)
        // offers no Retry; fixing the data is the only remedy.
        this.retryButton.hidden = this.row.ref.kind === "invalid";
        this.openButton.hidden = status !== "ready" || this.viewerUrl === null;
        this.element.classList.toggle("tws-is-loading", status === "loading");
        this.element.classList.toggle("tws-is-error", status === "error");
        this.refreshText();
    }

    setLabelStyle(show: boolean, size: number, color: string): void {
        this.label.hidden = !show;
        this.label.style.fontSize = `${size}px`;
        this.label.style.color = color;
    }

    setSelection(selected: boolean, dimmed: boolean): void {
        this.selected = selected;
        this.dimmed = dimmed;
        this.element.classList.toggle("tws-selected", selected);
        this.element.classList.toggle("tws-dimmed", dimmed);
        this.element.setAttribute("aria-selected", String(selected));
    }

    refreshText(): void {
        const title = this.title;
        this.label.textContent = title;
        const state = this.status === "loading"
            ? "loading"
            : this.status === "error"
                ? `could not load: ${this.errorMessage ?? "unknown error"}`
                : "3D model";
        this.element.setAttribute("aria-label", `${title}, ${state}`);
    }
}
