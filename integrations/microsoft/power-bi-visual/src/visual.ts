"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import { DataState, ModelData, readDataView } from "./dataModel";
import { clear, el, icon } from "./dom";
import { gridRects, gridShape, Rect, resolveLayout, scaleFor, tintFor } from "./encoding";
import { buildLanding } from "./landing";
import { describeLoadError, ModelCache } from "./loader";
import { THREE_WS_ORIGIN } from "./modelRef";
import { ModelLoadError, ModelResolver } from "./resolver";
import { disposeObject, SceneRenderer, TileDraw, WebGLUnavailableError } from "./sceneRenderer";
import { toViewSettings, ViewSettings, VisualFormattingSettingsModel } from "./settings";
import { Tile, TileHandlers } from "./tileView";

import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import PrivilegeStatus = powerbi.PrivilegeStatus;

const GAP = 8;
const STRIP_HEIGHT = 48;
// PrivilegeStatus is an ambient const enum; the two refusals are spelled out
// with the values the API declares so per-file transpilers can read them.
const NOT_SUPPORTED = 2 as PrivilegeStatus;
const DISABLED_BY_ADMIN = 3 as PrivilegeStatus;

export class Visual implements IVisual {
    private readonly host: IVisualHost;
    private readonly events: IVisualEventService;
    private readonly selectionManager: ISelectionManager;
    private readonly formattingService = new FormattingSettingsService();
    private formattingSettings = new VisualFormattingSettingsModel();
    private settings: ViewSettings = toViewSettings(this.formattingSettings);

    private readonly root: HTMLElement;
    private readonly stage: HTMLDivElement;
    private readonly tileLayer: HTMLDivElement;
    private readonly strip: HTMLDivElement;
    private readonly landingHost: HTMLDivElement;
    private readonly message: HTMLDivElement;
    private readonly note: HTMLDivElement;
    private readonly renderer: SceneRenderer | null;

    private readonly resolver = new ModelResolver(THREE_WS_ORIGIN);
    private readonly cache = new ModelCache();
    private readonly tiles = new Map<string, Tile>();
    private readonly tileUrls = new Map<string, string[]>();
    private readonly handlers: TileHandlers;

    private data: ModelData | null = null;
    private viewport = { width: 0, height: 0 };
    private order: Tile[] = [];
    private draws: TileDraw[] = [];
    private gridCols = 1;
    private galleryIndex = 0;
    private selectedIds: ISelectionId[] = [];
    private tooltipKey: string | null = null;

    private updateToken = 0;
    private pendingRender: VisualUpdateOptions | null = null;
    private webAccess: Promise<void> | null = null;
    private blockedMessage: string | null = null;

    // pbiviz's generated plugin passes the options as optional; the host always
    // supplies them.
    constructor(options?: VisualConstructorOptions) {
        if (!options) throw new TypeError("The three.ws visual needs constructor options from the Power BI host.");
        this.host = options.host;
        this.events = this.host.eventService;
        this.selectionManager = this.host.createSelectionManager();
        this.root = options.element;
        this.root.classList.add("tws-root");

        this.stage = el("div", "tws-stage");
        this.tileLayer = el("div", "tws-tiles", { role: "listbox", "aria-label": "3D models", "aria-multiselectable": "true" });
        this.strip = el("div", "tws-strip", { role: "toolbar", "aria-label": "Gallery models" });
        this.landingHost = el("div", "tws-landing-host");
        this.message = el("div", "tws-message", { role: "alert" });
        this.note = el("div", "tws-note");
        this.strip.hidden = true;
        this.message.hidden = true;
        this.note.hidden = true;
        this.root.append(this.stage, this.landingHost, this.message);
        this.stage.append(this.tileLayer, this.strip, this.note);

        let renderer: SceneRenderer | null = null;
        try {
            renderer = new SceneRenderer(this.stage);
            this.stage.insertBefore(renderer.canvas, this.tileLayer);
        } catch (error) {
            if (!(error instanceof WebGLUnavailableError)) throw error;
        }
        this.renderer = renderer;

        this.handlers = {
            select: (tile, event) => this.selectTile(tile, event),
            contextMenu: (tile, event) => this.contextMenu(tile.row.selectionId, event),
            tooltip: (tile, event) => this.tooltip(tile, event),
            orbit: (tile, dx, dy) => this.renderer?.orbit(tile.row.key, dx, dy),
            retry: (tile) => this.retry(tile),
            open: (tile) => {
                const url = tile.viewerUrl;
                if (url) this.host.launchUrl(url);
            },
            navigate: (tile, event) => this.navigate(tile, event),
        };

        this.stage.addEventListener("click", () => this.clearSelection());
        this.stage.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            this.contextMenu({} as ISelectionId, event);
        });
        this.tileLayer.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.clearSelection();
        });
        this.selectionManager.registerOnSelectCallback((ids) => {
            this.selectedIds = ids as ISelectionId[];
            this.applySelection();
        });
    }

    public update(options: VisualUpdateOptions): void {
        // A newer update replaces whatever the previous one was still drawing,
        // so the previous render is reported finished before the next starts.
        if (this.pendingRender) this.events.renderingFinished(this.pendingRender);
        this.pendingRender = options;
        this.events.renderingStarted(options);
        const token = ++this.updateToken;

        try {
            const dataView = options.dataViews?.[0];
            this.formattingSettings = this.formattingService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.settings = toViewSettings(this.formattingSettings);
            this.viewport = { width: Math.max(0, options.viewport.width), height: Math.max(0, options.viewport.height) };

            if (!this.renderer) {
                this.showMessage("WebGL is not available in this browser, so 3D models cannot be drawn. Open the report in a current version of Edge, Chrome, Firefox or Safari.");
                this.fail(options, "WebGL unavailable");
                return;
            }

            this.renderer.setSize(this.viewport.width, this.viewport.height);
            this.renderer.setBackground(this.settings.background);
            this.renderer.setLighting(this.settings.lighting);
            this.renderer.setMotion(this.settings.autoRotate, this.settings.rotationSpeed);

            const state: DataState = readDataView(dataView, this.host);
            if (state.kind !== "rows") {
                this.showLanding(state.kind === "needsModel" ? "needsModel" : "empty");
            } else {
                this.showRows(state.model);
            }
            this.settle(token, options);
        } catch (error) {
            this.fail(options, error instanceof Error ? error.message : String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.updateToken++;
        this.pendingRender = null;
        this.host.tooltipService?.hide({ immediately: true, isTouchEvent: false });
        for (const tile of this.tiles.values()) tile.loadToken++;
        this.tiles.clear();
        this.renderer?.dispose();
        this.cache.retain(new Set(), disposeObject);
        clear(this.root);
        this.root.classList.remove("tws-root");
    }

    private fail(options: VisualUpdateOptions, reason: string): void {
        if (this.pendingRender === options) this.pendingRender = null;
        this.events.renderingFailed(options, reason);
    }

    /** renderingFinished fires once every visible tile has drawn or failed and a frame is on screen. */
    private settle(token: number, options: VisualUpdateOptions): void {
        const visible = this.order.filter((t) => !t.element.hidden);
        void Promise.all(visible.map((t) => t.settled))
            .then(() => this.renderer?.nextFrame())
            .then(() => {
                if (token !== this.updateToken || this.pendingRender !== options) return;
                this.pendingRender = null;
                this.events.renderingFinished(options);
            });
    }

    private showMessage(text: string): void {
        this.message.textContent = text;
        this.message.hidden = false;
        this.stage.hidden = true;
        this.landingHost.hidden = true;
    }

    private showLanding(state: "empty" | "needsModel"): void {
        this.data = null;
        this.syncTiles([]);
        this.message.hidden = true;
        this.stage.hidden = true;
        this.landingHost.hidden = false;
        clear(this.landingHost);
        this.landingHost.appendChild(buildLanding(state));
        this.renderer?.setDraws([]);
    }

    private showRows(data: ModelData): void {
        this.data = data;
        this.landingHost.hidden = true;
        clear(this.landingHost);
        this.message.hidden = true;
        this.stage.hidden = false;
        this.syncTiles(data.rows.map((r) => r.key));
        this.selectedIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        this.layout();
    }

    /** Creates, reuses and removes tiles so models that stay bound are not reloaded. */
    private syncTiles(keys: string[]): void {
        const keep = new Set(keys);
        for (const [key, tile] of this.tiles) {
            if (keep.has(key)) continue;
            tile.loadToken++;
            tile.element.remove();
            this.tiles.delete(key);
            this.tileUrls.delete(key);
        }
        this.renderer?.retain(keep);
        this.cache.retain(new Set([...this.tileUrls.values()].flat()), disposeObject);

        const rows = this.data?.rows ?? [];
        this.order = rows.map((row) => {
            let tile = this.tiles.get(row.key);
            if (tile && JSON.stringify(tile.row.ref) !== JSON.stringify(row.ref)) {
                tile.loadToken++;
                tile.element.remove();
                this.tileUrls.delete(row.key);
                this.renderer?.remove(row.key);
                tile = undefined;
            }
            if (!tile) {
                tile = new Tile(row, this.handlers);
                this.tiles.set(row.key, tile);
            } else {
                tile.row = row;
                tile.refreshText();
            }
            this.tileLayer.appendChild(tile.element);
            return tile;
        });
    }

    private layout(): void {
        const data = this.data;
        if (!data || !this.renderer) return;
        const { width, height } = this.viewport;
        const s = this.settings;
        const mode = resolveLayout(s.layout, this.order.length, width, height);
        const visible = new Map<Tile, Rect>();

        if (mode === "gallery" && this.order.length > 1) {
            this.galleryIndex = Math.min(Math.max(0, this.galleryIndex), this.order.length - 1);
            const stripHeight = Math.min(STRIP_HEIGHT, Math.max(32, height * 0.25));
            visible.set(this.order[this.galleryIndex], { x: 0, y: 0, width, height: Math.max(1, height - stripHeight - GAP) });
            this.buildStrip(stripHeight);
            this.gridCols = 1;
        } else {
            this.strip.hidden = true;
            const rects = gridRects(this.order.length, width, height, this.order.length > 1 ? GAP : 0);
            this.gridCols = gridShape(this.order.length, width, height).cols;
            this.order.forEach((tile, i) => visible.set(tile, rects[i]));
        }
        this.tileLayer.classList.toggle("tws-single", this.order.length === 1);

        const draws: TileDraw[] = [];
        for (const tile of this.order) {
            const rect = visible.get(tile);
            tile.setVisible(Boolean(rect));
            tile.setLabelStyle(s.showLabels, s.labelSize, s.labelColor);
            if (!rect) continue;
            tile.setRect(rect);
            draws.push({
                key: tile.row.key,
                rect,
                scale: scaleFor(tile.row.scaleValue, data.scaleMax),
                tint: tintFor({ mode: s.colorMode, value: tile.row.colorValue, range: data.colorRange, low: s.lowColor, high: s.highColor, tint: s.tintColor }),
                dim: false,
            });
        }

        // The gallery downloads the focused model and its neighbours only.
        const toLoad = mode === "gallery" && this.order.length > 1
            ? [this.galleryIndex - 1, this.galleryIndex, this.galleryIndex + 1].map((i) => this.order[i]).filter(Boolean)
            : this.order;
        for (const tile of toLoad) {
            if (tile.loadToken === 0) this.load(tile);
        }

        this.draws = draws;
        this.note.hidden = !data.truncated;
        this.note.textContent = data.truncated ? `Showing the first ${data.rows.length} rows` : "";
        this.showBlocked();
        this.applySelection();
    }

    private buildStrip(height: number): void {
        clear(this.strip);
        this.strip.hidden = false;
        this.strip.style.height = `${height}px`;
        const go = (index: number): void => {
            this.galleryIndex = (index + this.order.length) % this.order.length;
            this.layout();
            this.order[this.galleryIndex].element.focus({ preventScroll: true });
        };
        const prev = el("button", "tws-nav", { type: "button", "aria-label": "Previous model" }, icon("prev"));
        const next = el("button", "tws-nav", { type: "button", "aria-label": "Next model" }, icon("next"));
        prev.addEventListener("click", (event) => { event.stopPropagation(); go(this.galleryIndex - 1); });
        next.addEventListener("click", (event) => { event.stopPropagation(); go(this.galleryIndex + 1); });
        const chips = el("div", "tws-chips");
        this.order.forEach((tile, i) => {
            const chip = el(
                "button",
                "tws-chip",
                { type: "button", "aria-current": i === this.galleryIndex ? "true" : null, title: tile.title },
                tile.title,
            );
            chip.classList.toggle("tws-chip-selected", tile.selected);
            chip.classList.toggle("tws-chip-error", tile.status === "error");
            chip.addEventListener("click", (event) => { event.stopPropagation(); go(i); });
            chips.appendChild(chip);
        });
        this.strip.append(prev, chips, next);
        const current = chips.children[this.galleryIndex] as HTMLElement | undefined;
        if (current) chips.scrollLeft = Math.max(0, current.offsetLeft - chips.clientWidth / 2 + current.offsetWidth / 2);
    }

    private ensureWebAccess(): Promise<void> {
        if (!this.webAccess) {
            const service = this.host.webAccessService;
            this.webAccess = service
                ? Promise.resolve(service.webAccessStatus(THREE_WS_ORIGIN)).then((status) => {
                    if (status === DISABLED_BY_ADMIN) {
                        this.blockedMessage = "Your Power BI administrator has turned off web access for custom visuals, so models from three.ws cannot load. Ask them to allow web access for certified and uncertified visuals, or for this visual.";
                    } else if (status === NOT_SUPPORTED) {
                        this.blockedMessage = "This Power BI host does not allow custom visuals to download files, so models from three.ws cannot load here. Open the report in Power BI Service or Power BI Desktop.";
                    }
                    if (this.blockedMessage) {
                        this.showBlocked();
                        throw new ModelLoadError(this.blockedMessage);
                    }
                })
                : Promise.resolve();
        }
        return this.webAccess;
    }

    private showBlocked(): void {
        if (this.blockedMessage && this.data) this.showMessage(this.blockedMessage);
    }

    private load(tile: Tile): void {
        const token = ++tile.loadToken;
        tile.setStatus("loading");
        tile.settled = (async () => {
            try {
                await this.ensureWebAccess();
                const resolved = await this.resolver.resolve(tile.row.ref);
                if (token !== tile.loadToken) return;
                tile.resolvedTitle = resolved.title;
                this.tileUrls.set(tile.row.key, resolved.urls);
                const { scene } = await this.cache.load(resolved.urls);
                if (token !== tile.loadToken || this.tiles.get(tile.row.key) !== tile) return;
                this.renderer?.setModel(tile.row.key, scene);
                tile.setStatus("ready");
            } catch (error) {
                if (token !== tile.loadToken) return;
                tile.setStatus("error", error instanceof ModelLoadError ? error.message : describeLoadError(error));
            }
            this.refreshStripChip(tile);
        })();
    }

    private refreshStripChip(tile: Tile): void {
        if (this.strip.hidden) return;
        const index = this.order.indexOf(tile);
        const chip = this.strip.querySelector(".tws-chips")?.children[index] as HTMLElement | undefined;
        if (!chip) return;
        chip.textContent = tile.title;
        chip.title = tile.title;
        chip.classList.toggle("tws-chip-error", tile.status === "error");
    }

    private retry(tile: Tile): void {
        this.load(tile);
        const options = this.pendingRender;
        if (options) this.settle(this.updateToken, options);
    }

    private allowInteractions(): boolean {
        return this.host.hostCapabilities?.allowInteractions !== false;
    }

    private selectTile(tile: Tile, event: MouseEvent | KeyboardEvent): void {
        if (!this.allowInteractions()) return;
        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
        void Promise.resolve(this.selectionManager.select(tile.row.selectionId, multi)).then((ids) => {
            this.selectedIds = (ids as ISelectionId[]) ?? [];
            this.applySelection();
        });
    }

    private clearSelection(): void {
        if (!this.allowInteractions() || this.selectedIds.length === 0) return;
        void Promise.resolve(this.selectionManager.clear()).then(() => {
            this.selectedIds = [];
            this.applySelection();
        });
    }

    private contextMenu(id: ISelectionId, event: MouseEvent): void {
        if (!this.allowInteractions()) return;
        void this.selectionManager.showContextMenu(id, { x: event.clientX, y: event.clientY });
    }

    /** Report selections and cross-highlights fade every model that is not part of them. */
    private applySelection(): void {
        const data = this.data;
        if (!data || !this.renderer) return;
        const anySelected = this.selectedIds.length > 0;
        for (const tile of this.order) {
            const selected = anySelected && this.selectedIds.some((id) => id.equals(tile.row.selectionId));
            const dimmed = anySelected ? !selected : data.hasHighlights && !tile.row.highlighted;
            tile.setSelection(selected, dimmed);
        }
        const chips = this.strip.hidden ? null : this.strip.querySelector(".tws-chips");
        if (chips) this.order.forEach((tile, i) => chips.children[i]?.classList.toggle("tws-chip-selected", tile.selected));
        this.renderer.setDraws(this.draws.map((d) => ({ ...d, dim: this.tiles.get(d.key)?.dimmed ?? false })));
    }

    private tooltip(tile: Tile, event: PointerEvent | null): void {
        const service = this.host.tooltipService;
        if (!service?.enabled()) return;
        if (!event) {
            if (this.tooltipKey !== null) service.hide({ immediately: true, isTouchEvent: false });
            this.tooltipKey = null;
            return;
        }
        const box = this.root.getBoundingClientRect();
        const items = tile.row.tooltipItems.length > 0 ? tile.row.tooltipItems : [{ displayName: "Model", value: tile.title }];
        const args = {
            coordinates: [event.clientX - box.left, event.clientY - box.top],
            isTouchEvent: event.pointerType === "touch",
            dataItems: items,
            identities: [tile.row.selectionId],
        };
        if (this.tooltipKey === tile.row.key) service.move(args);
        else service.show(args);
        this.tooltipKey = tile.row.key;
    }

    private navigate(tile: Tile, event: KeyboardEvent): void {
        const index = this.order.indexOf(tile);
        if (index < 0) return;
        const galleryActive = !this.strip.hidden;
        const step = galleryActive ? 1 : this.gridCols;
        const moves: Record<string, number> = {
            ArrowRight: 1,
            ArrowLeft: -1,
            ArrowDown: galleryActive ? 1 : step,
            ArrowUp: galleryActive ? -1 : -step,
            Home: -index,
            End: this.order.length - 1 - index,
        };
        const delta = moves[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        let target = index + delta;
        if (galleryActive) {
            target = (target + this.order.length) % this.order.length;
            this.galleryIndex = target;
            this.layout();
        } else {
            target = Math.min(this.order.length - 1, Math.max(0, target));
        }
        this.order[target].element.focus({ preventScroll: true });
    }
}
