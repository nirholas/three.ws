"use strict";

import { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DRACO_DECODER_WASM_BASE64, DRACO_WASM_WRAPPER_JS } from "./generated/dracoDecoder";
import { ModelLoadError } from "./resolver";

/**
 * GLB loading with every decoder production three.ws files need, bundled.
 *
 *   - EXT_meshopt_compression: three.js's meshopt decoder (WebAssembly inlined).
 *   - KHR_draco_mesh_compression: the Draco decoder from the same three.js
 *     release, embedded at build time by scripts/embed-decoders.mjs, so
 *     DRACOLoader never fetches it from a CDN.
 *   - EXT_texture_webp and KHR_mesh_quantization: native in GLTFLoader.
 */

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** DRACOLoader that serves its decoder from the bundle instead of the network. */
class BundledDracoLoader extends DRACOLoader {
    constructor() {
        super();
        this.setDecoderConfig({ type: "wasm" });
        this.setWorkerLimit(2);
    }

    // DRACOLoader asks for exactly two files in wasm mode. Anything else means
    // the browser has no WebAssembly and fell back to the JS decoder, which is
    // not bundled.
    _loadLibrary(url: string, responseType: string): Promise<string | ArrayBuffer> {
        if (url.endsWith("draco_wasm_wrapper.js") && responseType === "text") {
            return Promise.resolve(DRACO_WASM_WRAPPER_JS);
        }
        if (url.endsWith("draco_decoder.wasm") && responseType === "arraybuffer") {
            return Promise.resolve(base64ToArrayBuffer(DRACO_DECODER_WASM_BASE64));
        }
        return Promise.reject(new ModelLoadError("This browser cannot decode Draco-compressed models (WebAssembly is unavailable)."));
    }
}

declare module "three/examples/jsm/loaders/DRACOLoader.js" {
    interface DRACOLoader {
        _loadLibrary(url: string, responseType: string): Promise<string | ArrayBuffer>;
    }
}

export function createGltfLoader(): GLTFLoader {
    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    loader.setDRACOLoader(new BundledDracoLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
}

function statusOf(error: unknown): number | null {
    const response = (error as { response?: { status?: number } } | null)?.response;
    return typeof response?.status === "number" ? response.status : null;
}

/** Converts whatever three.js threw into a sentence a report author can act on. */
export function describeLoadError(error: unknown): string {
    if (error instanceof ModelLoadError) return error.message;
    const status = statusOf(error);
    if (status === 404) return "The model file was not found (404). Check the URL in this row.";
    if (status === 403 || status === 401) return `The model file is not public (HTTP ${status}).`;
    if (status !== null) return `The model file could not be downloaded (HTTP ${status}).`;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TypeError || /fetch|network|cors/i.test(message)) {
        return "Could not download the model file. Check that web access is allowed for this visual.";
    }
    if (/magic|json|unexpected|parse|glTF/i.test(message)) {
        return "The file is not a valid GLB or glTF model.";
    }
    return `The model could not be displayed: ${message}`;
}

/**
 * Loads the first URL that works. Later URLs are fallbacks for the same model
 * (the original GLB behind a web-optimised one), so the error reported is the
 * one from the first, preferred URL unless every URL failed differently.
 */
export class ModelCache {
    private readonly loader = createGltfLoader();
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

    /** Frees GPU-side data for URLs no longer bound to any row. */
    retain(urls: Set<string>, dispose: (scene: Object3D) => void): void {
        for (const [url, pending] of this.scenes) {
            if (urls.has(url)) continue;
            this.scenes.delete(url);
            pending.then(dispose, () => undefined);
        }
    }
}
