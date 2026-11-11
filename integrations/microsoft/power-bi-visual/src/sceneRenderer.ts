"use strict";

import {
    ACESFilmicToneMapping,
    AmbientLight,
    Box3,
    CanvasTexture,
    CircleGeometry,
    Color,
    DirectionalLight,
    Group,
    HemisphereLight,
    Material,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PerspectiveCamera,
    PMREMGenerator,
    Scene,
    SRGBColorSpace,
    Sphere,
    Texture,
    Vector3,
    WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Rect } from "./encoding";
import { LightingPreset } from "./settings";

/**
 * Draws every model tile from one WebGL context.
 *
 * Browsers cap live WebGL contexts at a small number per page and a Power BI
 * report page can hold several copies of this visual, so the visual never
 * creates a context per tile. All models live in one scene, spaced far apart;
 * each tile has its own camera and is drawn into its own viewport with the
 * scissor test. Lights are directional or ambient, so one rig lights every
 * model identically.
 */

export interface TileDraw {
    key: string;
    rect: Rect;
    scale: number;
    tint: string | null;
    /** Faded back because another row is selected or highlighted. */
    dim: boolean;
}

interface MaterialState {
    material: Material & { color?: Color };
    base: Color | null;
    opacity: number;
    transparent: boolean;
}

interface Slot {
    index: number;
    holder: Group;
    pivot: Group;
    camera: PerspectiveCamera;
    model: Object3D | null;
    shadow: Mesh;
    materials: MaterialState[];
    tint: string | null;
    dim: boolean;
    yaw: number;
    elevation: number;
}

const SPACING = 100;
const FOV = 30;
const DEFAULT_ELEVATION = 0.32;
const DIM_OPACITY = 0.22;

export class WebGLUnavailableError extends Error {
    constructor() {
        super("WebGL is not available in this browser, so 3D models cannot be drawn.");
        this.name = "WebGLUnavailableError";
    }
}

function makeShadowTexture(): Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, "rgba(0,0,0,0.38)");
        g.addColorStop(0.55, "rgba(0,0,0,0.12)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

function disposeMaterial(material: Material): void {
    material.dispose();
}

/** Frees geometries and textures of a loaded scene that nothing references any more. */
export function disposeObject(root: Object3D): void {
    root.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
            if (!m) continue;
            for (const value of Object.values(m)) {
                if (value && (value as Texture).isTexture) (value as Texture).dispose();
            }
            m.dispose();
        }
    });
}

export class SceneRenderer {
    readonly canvas: HTMLCanvasElement;
    private readonly renderer: WebGLRenderer;
    private readonly scene = new Scene();
    private readonly rig = new Group();
    private readonly slots = new Map<string, Slot>();
    private readonly freeIndices: number[] = [];
    private readonly shadowTexture: Texture;
    private readonly pmrem: PMREMGenerator;
    private readonly roomEnvironment: Texture;
    private nextIndex = 0;
    private draws: TileDraw[] = [];
    private width = 1;
    private height = 1;
    private autoRotate = true;
    private speedRadians = (20 * Math.PI) / 180;
    private frame = 0;
    private lastTime = 0;
    private dirty = true;
    private frameWaiters: Array<() => void> = [];
    private lighting: LightingPreset | null = null;
    private readonly reducedMotion: MediaQueryList | null;

    constructor(container: HTMLElement) {
        this.canvas = document.createElement("canvas");
        this.canvas.className = "tws-canvas";
        this.canvas.setAttribute("aria-hidden", "true");
        try {
            this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "low-power" });
        } catch {
            throw new WebGLUnavailableError();
        }
        container.appendChild(this.canvas);
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.toneMapping = ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.setScissorTest(true);
        this.renderer.setClearColor(0x000000, 0);

        this.pmrem = new PMREMGenerator(this.renderer);
        this.roomEnvironment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.shadowTexture = makeShadowTexture();
        this.scene.add(this.rig);
        this.setLighting("studio");

        this.reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

        this.canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); });
        this.canvas.addEventListener("webglcontextrestored", () => { this.requestRender(); });
    }

    setSize(width: number, height: number): void {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(this.width, this.height, true);
        this.requestRender();
    }

    setBackground(hex: string | null): void {
        if (hex) this.renderer.setClearColor(new Color(hex), 1);
        else this.renderer.setClearColor(0x000000, 0);
        this.requestRender();
    }

    setMotion(autoRotate: boolean, degreesPerSecond: number): void {
        this.autoRotate = autoRotate;
        this.speedRadians = (degreesPerSecond * Math.PI) / 180;
        this.requestRender();
    }

    setLighting(preset: LightingPreset): void {
        if (preset === this.lighting) return;
        this.lighting = preset;
        for (const child of [...this.rig.children]) this.rig.remove(child);

        const key = new DirectionalLight(0xffffff, 1);
        if (preset === "studio") {
            this.scene.environment = this.roomEnvironment;
            this.scene.environmentIntensity = 1;
            key.intensity = 1.4;
            key.position.set(3, 5, 4);
            const fill = new DirectionalLight(0xdfe8ff, 0.4);
            fill.position.set(-4, 2, 3);
            this.rig.add(key, fill);
        } else if (preset === "soft") {
            this.scene.environment = this.roomEnvironment;
            this.scene.environmentIntensity = 0.55;
            this.rig.add(new HemisphereLight(0xffffff, 0xb9b3a6, 1.6));
            key.intensity = 0.7;
            key.position.set(2, 6, 3);
            this.rig.add(key);
        } else if (preset === "dramatic") {
            this.scene.environment = this.roomEnvironment;
            this.scene.environmentIntensity = 0.2;
            key.color.set(0xffe2c0);
            key.intensity = 3.2;
            key.position.set(-4, 6, 2);
            const rim = new DirectionalLight(0x9cc4ff, 2.4);
            rim.position.set(1, 3, -5);
            this.rig.add(key, rim, new AmbientLight(0xffffff, 0.06));
        } else {
            this.scene.environment = null;
            this.rig.add(new AmbientLight(0xffffff, 2.8));
        }
        this.requestRender();
    }

    private ensureSlot(key: string): Slot {
        const existing = this.slots.get(key);
        if (existing) return existing;
        const index = this.freeIndices.pop() ?? this.nextIndex++;
        const holder = new Group();
        holder.position.set(index * SPACING, 0, 0);
        const pivot = new Group();
        holder.add(pivot);
        const shadow = new Mesh(
            new CircleGeometry(1, 48),
            new MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, toneMapped: false }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.visible = false;
        pivot.add(shadow);
        const camera = new PerspectiveCamera(FOV, 1, 0.05, 50);
        this.scene.add(holder);
        const slot: Slot = { index, holder, pivot, camera, model: null, shadow, materials: [], tint: null, dim: false, yaw: index * 0.7, elevation: DEFAULT_ELEVATION };
        this.slots.set(key, slot);
        return slot;
    }

    /** Places a loaded model in the tile's slot, normalised to a unit sphere. */
    setModel(key: string, source: Object3D): void {
        const slot = this.ensureSlot(key);
        this.clearModel(slot);

        const model = cloneSkinned(source);
        const materials: MaterialState[] = [];
        model.traverse((node) => {
            const mesh = node as Mesh;
            if (!mesh.isMesh) return;
            const cloneOne = (m: Material): Material => {
                const copy = m.clone() as Material & { color?: Color };
                materials.push({ material: copy, base: copy.color ? copy.color.clone() : null, opacity: copy.opacity, transparent: copy.transparent });
                return copy;
            };
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneOne) : cloneOne(mesh.material);
        });

        const box = new Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new Sphere());
        const radius = sphere.radius > 0 && Number.isFinite(sphere.radius) ? sphere.radius : 1;
        const norm = 1 / radius;
        model.scale.setScalar(norm);
        model.position.copy(sphere.center).multiplyScalar(-norm);

        const size = box.getSize(new Vector3()).multiplyScalar(norm);
        slot.shadow.position.y = -size.y / 2 - 0.005;
        slot.shadow.scale.setScalar(Math.max(size.x, size.z) * 0.62 + 0.12);
        slot.shadow.visible = true;

        slot.pivot.add(model);
        slot.model = model;
        slot.materials = materials;
        slot.tint = null;
        slot.dim = false;
        // Re-apply the tile's current tint, dim and scale to the new materials.
        this.setDraws(this.draws);
    }

    private clearModel(slot: Slot): void {
        if (!slot.model) return;
        slot.pivot.remove(slot.model);
        for (const state of slot.materials) disposeMaterial(state.material);
        slot.model = null;
        slot.materials = [];
        slot.shadow.visible = false;
    }

    hasModel(key: string): boolean {
        return Boolean(this.slots.get(key)?.model);
    }

    /** Drops slots for tiles that left the data. */
    retain(keys: Set<string>): void {
        for (const key of [...this.slots.keys()]) {
            if (!keys.has(key)) this.remove(key);
        }
    }

    remove(key: string): void {
        const slot = this.slots.get(key);
        if (!slot) return;
        this.clearModel(slot);
        this.scene.remove(slot.holder);
        (slot.shadow.material as Material).dispose();
        slot.shadow.geometry.dispose();
        this.slots.delete(key);
        this.freeIndices.push(slot.index);
        this.requestRender();
    }

    setDraws(draws: TileDraw[]): void {
        this.draws = draws;
        for (const draw of draws) {
            const slot = this.ensureSlot(draw.key);
            if (slot.tint !== draw.tint) {
                const tint = draw.tint ? new Color(draw.tint) : null;
                for (const state of slot.materials) {
                    if (!state.material.color || !state.base) continue;
                    state.material.color.copy(tint ?? state.base);
                }
                slot.tint = draw.tint;
            }
            if (slot.dim !== draw.dim) {
                for (const state of slot.materials) {
                    state.material.transparent = draw.dim || state.transparent;
                    state.material.opacity = draw.dim ? state.opacity * DIM_OPACITY : state.opacity;
                    state.material.needsUpdate = true;
                }
                (slot.shadow.material as MeshBasicMaterial).opacity = draw.dim ? DIM_OPACITY : 1;
                slot.dim = draw.dim;
            }
            slot.pivot.scale.setScalar(draw.scale);
        }
        this.requestRender();
    }

    /** Pointer drag on a tile: horizontal turns the model, vertical tilts the camera. */
    orbit(key: string, dx: number, dy: number): void {
        const slot = this.slots.get(key);
        if (!slot) return;
        slot.yaw += dx * 0.01;
        slot.elevation = Math.min(1.3, Math.max(-0.4, slot.elevation + dy * 0.01));
        this.requestRender();
    }

    /** Resolves after the next frame has been drawn. */
    nextFrame(): Promise<void> {
        return new Promise((resolve) => {
            this.frameWaiters.push(resolve);
            this.requestRender();
        });
    }

    requestRender(): void {
        this.dirty = true;
        if (this.frame === 0) {
            this.lastTime = performance.now();
            this.frame = window.requestAnimationFrame(this.tick);
        }
    }

    private spinning(): boolean {
        return this.autoRotate && !this.reducedMotion?.matches && this.draws.length > 0;
    }

    private readonly tick = (now: number): void => {
        this.frame = 0;
        const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
        this.lastTime = now;
        const spinning = this.spinning();
        if (spinning) {
            for (const draw of this.draws) {
                const slot = this.slots.get(draw.key);
                if (slot) slot.yaw += this.speedRadians * dt;
            }
        }
        this.draw();
        this.dirty = false;
        const waiters = this.frameWaiters;
        this.frameWaiters = [];
        for (const resolve of waiters) resolve();
        if (spinning) this.frame = window.requestAnimationFrame(this.tick);
    };

    private draw(): void {
        const r = this.renderer;
        r.setScissor(0, 0, this.width, this.height);
        r.setViewport(0, 0, this.width, this.height);
        r.clear(true, true, true);
        for (const draw of this.draws) {
            const slot = this.slots.get(draw.key);
            if (!slot || !slot.model) continue;
            const { x, y, width, height } = draw.rect;
            if (width < 2 || height < 2) continue;
            const glY = this.height - y - height;
            r.setViewport(x, glY, width, height);
            r.setScissor(x, glY, width, height);

            slot.pivot.rotation.y = slot.yaw;
            const cam = slot.camera;
            cam.aspect = width / height;
            const vHalf = (FOV * Math.PI) / 360;
            const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
            const distance = (1.08 / Math.sin(Math.min(vHalf, hHalf)));
            const e = slot.elevation;
            cam.position.set(
                slot.holder.position.x,
                Math.sin(e) * distance,
                Math.cos(e) * distance,
            );
            cam.lookAt(slot.holder.position.x, 0, 0);
            cam.updateProjectionMatrix();
            r.render(this.scene, cam);
        }
    }

    dispose(): void {
        if (this.frame !== 0) window.cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.retain(new Set());
        this.roomEnvironment.dispose();
        this.pmrem.dispose();
        this.shadowTexture.dispose();
        this.renderer.dispose();
        this.canvas.remove();
    }
}
