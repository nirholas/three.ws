"use strict";

import { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Type-only: the DRACOLoader module itself must stay out of the bundle (see draco.ts).
import type { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { BundledDracoDecoder, DracoUnavailableError } from "./draco";
import { ModelLoadError } from "./resolver";
import { t } from "./strings";

/**
 * GLB loading with every decoder production three.ws files need, bundled.
 *
 *   - EXT_meshopt_compression: three.js's meshopt decoder (WebAssembly inlined).
 *   - KHR_draco_mesh_compression: the glTF Draco decoder from the same three.js
 *     release, embedded at build time by scripts/embed-decoders.mjs and run by
 *     BundledDracoDecoder, so nothing is fetched from a CDN.
 *   - EXT_texture_webp and KHR_mesh_quantization: native in GLTFLoader.
 */

export function createGltfLoader(draco: BundledDracoDecoder = new BundledDracoDecoder()): GLTFLoader {
    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    loader.setDRACOLoader(draco as unknown as DRACOLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
}

function statusOf(error: unknown): number | null {
    const response = (error as { response?: { status?: number } } | null)?.response;
    return typeof response?.status === "number" ? response.status : null;
}

/** Converts whatever three.js threw into a sentence a report author can act on. */
export function describeLoadError(error: unknown): string {
    if (error instanceof ModelLoadError || error instanceof DracoUnavailableError) return error.message;
    const status = statusOf(error);
    if (status === 404) return t("Err_FileNotFound");
    if (status === 403 || status === 401) return t("Err_FileNotPublic", status);
    if (status !== null) return t("Err_FileHttp", status);
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TypeError || /fetch|network|cors/i.test(message)) {
        return t("Err_Download");
    }
    if (/magic|json|unexpected|parse|glTF/i.test(message)) {
        return t("Err_InvalidFile");
    }
    return t("Err_Display", message);
}

/**
 * Loads the first URL that works. Later URLs are fallbacks for the same model
 * (the original GLB behind a web-optimised one), so the error reported is the
 * one from the first, preferred URL unless every URL failed differently.
 */
export class ModelCache {
    private readonly draco = new BundledDracoDecoder();
    private readonly loader = createGltfLoader(this.draco);
    private readonly scenes = new Map<string, Promise<Object3D>>();
    // A report can bind 100 rows; downloading them all at once starves the
    // first tiles a reader is looking at. Four parallel downloads keep the
    // connection busy without that.
    private readonly maxParallel = 4;
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    private async withSlot<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= this.maxParallel) {
            await new Promise<void>((resolve) => { this.waiting.push(resolve); });
        }
        this.active++;
        try {
            return await task();
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }

    async load(urls: string[]): Promise<{ scene: Object3D; url: string }> {
        let firstError: unknown = null;
        for (const url of urls) {
            try {
                return { scene: await this.loadOne(url), url };
            } catch (error) {
                if (firstError === null) firstError = error;
            }
        }
        throw new ModelLoadError(describeLoadError(firstError));
    }

    private loadOne(url: string): Promise<Object3D> {
        const cached = this.scenes.get(url);
        if (cached) return cached;
        const pending = this.withSlot(() => this.loader.loadAsync(url)).then((gltf) => gltf.scene);
        pending.catch(() => this.scenes.delete(url));
        this.scenes.set(url, pending);
        return pending;
    }

    dispose(dispose: (scene: Object3D) => void): void {
        this.retain(new Set(), dispose);
        this.draco.dispose();
    }

    /** Frees GPU-side data for URLs no longer bound to any row. */
    retain(urls: Set<string>, dispose: (scene: Object3D) => void): void {
        for (const [url, pending] of this.scenes) {
            if (urls.has(url)) continue;
            this.scenes.delete(url);
            pending.then(dispose, () => undefined);
        }
    }
}
