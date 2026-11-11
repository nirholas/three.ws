"use strict";

import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from "three";
import { DRACO_DECODER_WASM_BASE64, DRACO_WASM_WRAPPER_JS } from "./generated/dracoDecoder";

/**
 * KHR_draco_mesh_compression decoding for GLTFLoader, served entirely from the
 * bundle.
 *
 * three.js's own DRACOLoader references its decoder files with
 * `new URL(..., import.meta.url)`. pbiviz's webpack turns those into separate
 * emitted assets and then packages the wrong JavaScript file, and pbiviz has no
 * hook to switch that parsing off. This class implements the two methods
 * GLTFLoader calls on a Draco loader (`preload` and `decodeDracoFile`) and runs
 * the same decoder (the glTF build shipped with the pinned three.js) in one
 * dedicated worker created from the bundled source. The decode routine follows
 * DRACOLoader's worker so geometry comes out identical.
 */

interface WorkerAttribute {
    name: string;
    array: Float32Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;
    itemSize: number;
    stride: number;
}

interface WorkerGeometry {
    index: { array: Uint32Array } | null;
    attributes: WorkerAttribute[];
}

type WorkerReply =
    | { type: "decode"; id: number; geometry: WorkerGeometry }
    | { type: "error"; id: number; error: string };

/**
 * Worker entry point. It is serialised with toString() into the worker source,
 * so it may only use worker globals and must not reference anything from this
 * module.
 */
function dracoWorkerMain(): void {
    // The Emscripten module ships without type declarations.
    type Draco = any;
    const scope = self as unknown as {
        DracoDecoderModule: (config: { wasmBinary: ArrayBuffer; onModuleLoaded: (m: Draco) => void }) => void;
        onmessage: ((e: MessageEvent) => void) | null;
        postMessage: (message: unknown, transfer?: Transferable[]) => void;
    };
    let pending: Promise<{ draco: Draco }> | null = null;
    const arrayTypes: Record<string, { new (buffer: ArrayBufferLike, offset?: number, length?: number): ArrayLike<number> & { slice(): ArrayLike<number> }; BYTES_PER_ELEMENT: number }> = {
        Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array,
    };

    function dataType(draco: Draco, typeName: string): number {
        switch (typeName) {
            case "Float32Array": return draco.DT_FLOAT32;
            case "Int8Array": return draco.DT_INT8;
            case "Int16Array": return draco.DT_INT16;
            case "Int32Array": return draco.DT_INT32;
            case "Uint8Array": return draco.DT_UINT8;
            case "Uint16Array": return draco.DT_UINT16;
            default: return draco.DT_UINT32;
        }
    }

    function decode(draco: Draco, decoder: Draco, array: Int8Array, ids: Record<string, number>, types: Record<string, string>) {
        const geometryType = decoder.GetEncodedGeometryType(array);
        let mesh: Draco;
        let status: Draco;
        if (geometryType === draco.TRIANGULAR_MESH) {
            mesh = new draco.Mesh();
            status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh);
        } else if (geometryType === draco.POINT_CLOUD) {
            mesh = new draco.PointCloud();
            status = decoder.DecodeArrayToPointCloud(array, array.byteLength, mesh);
        } else {
            throw new Error("Unexpected Draco geometry type.");
        }
        if (!status.ok() || mesh.ptr === 0) {
            throw new Error(`Draco decoding failed: ${status.error_msg()}`);
        }

        const attributes = [];
        for (const name of Object.keys(ids)) {
            const typeName = types[name] in arrayTypes ? types[name] : "Float32Array";
            const TypedArray = arrayTypes[typeName];
            const attribute = decoder.GetAttributeByUniqueId(mesh, ids[name]);
            const count = mesh.num_points();
            const itemSize = attribute.num_components();
            const srcByteStride = itemSize * TypedArray.BYTES_PER_ELEMENT;
            const dstByteStride = Math.ceil(srcByteStride / 4) * 4;
            const dstStride = dstByteStride / TypedArray.BYTES_PER_ELEMENT;
            const srcByteLength = count * srcByteStride;
            const ptr = draco._malloc(srcByteLength);
            decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, dataType(draco, typeName), srcByteLength, ptr);
            const src = new TypedArray(draco.HEAPF32.buffer, ptr, srcByteLength / TypedArray.BYTES_PER_ELEMENT);
            let dst: ArrayLike<number>;
            if (srcByteStride === dstByteStride) {
                dst = src.slice();
            } else {
                const out = new TypedArray(new ArrayBuffer(count * dstByteStride)) as unknown as number[];
                for (let i = 0; i < count; i++) {
                    for (let j = 0; j < itemSize; j++) out[i * dstStride + j] = src[i * itemSize + j];
                }
                dst = out;
            }
            draco._free(ptr);
            attributes.push({ name, array: dst, itemSize, stride: dstStride });
        }

        let index: { array: Uint32Array } | null = null;
        if (geometryType === draco.TRIANGULAR_MESH) {
            const numIndices = mesh.num_faces() * 3;
            const byteLength = numIndices * 4;
            const ptr = draco._malloc(byteLength);
            decoder.GetTrianglesUInt32Array(mesh, byteLength, ptr);
            index = { array: new Uint32Array(draco.HEAPF32.buffer, ptr, numIndices).slice() };
            draco._free(ptr);
        }
        draco.destroy(mesh);
        return { index, attributes };
    }

    scope.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === "init") {
            pending = new Promise((resolve) => {
                scope.DracoDecoderModule({
                    wasmBinary: message.wasmBinary,
                    // The module object is thenable; wrap it so resolve does not unwrap it.
                    onModuleLoaded: (draco: Draco) => resolve({ draco }),
                });
            });
            return;
        }
        if (message.type !== "decode" || !pending) return;
        void pending.then(({ draco }) => {
            const decoder = new draco.Decoder();
            try {
                const geometry = decode(draco, decoder, new Int8Array(message.buffer), message.attributeIDs, message.attributeTypes);
                const transfer = geometry.attributes.map((a) => (a.array as unknown as Uint8Array).buffer as ArrayBuffer);
                if (geometry.index) transfer.push(geometry.index.array.buffer as ArrayBuffer);
                scope.postMessage({ type: "decode", id: message.id, geometry }, transfer);
            } catch (error) {
                scope.postMessage({ type: "error", id: message.id, error: error instanceof Error ? error.message : String(error) });
            } finally {
                draco.destroy(decoder);
            }
        });
    };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

export class DracoUnavailableError extends Error {
    constructor(reason: string) {
        super(`This model uses Draco compression, and the decoder could not start here (${reason}).`);
        this.name = "DracoUnavailableError";
    }
}

export class BundledDracoDecoder {
    private worker: Worker | null = null;
    private startError: Error | null = null;
    private nextId = 1;
    private readonly tasks = new Map<number, { resolve: (g: WorkerGeometry) => void; reject: (e: Error) => void }>();

    /** GLTFLoader calls this when it meets the extension. The worker starts lazily on the first decode. */
    preload(): this {
        return this;
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        if (this.startError) throw this.startError;
        try {
            const source = `${DRACO_WASM_WRAPPER_JS}\n(${dracoWorkerMain.toString()})();`;
            const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
            const worker = new Worker(url);
            URL.revokeObjectURL(url);
            worker.onmessage = (event: MessageEvent<WorkerReply>) => {
                const reply = event.data;
                const task = this.tasks.get(reply.id);
                if (!task) return;
                this.tasks.delete(reply.id);
                if (reply.type === "decode") task.resolve(reply.geometry);
                else task.reject(new Error(reply.error));
            };
            worker.onerror = (event) => {
                event.preventDefault();
                this.failAll(new DracoUnavailableError(event.message || "worker error"));
            };
            worker.postMessage({ type: "init", wasmBinary: base64ToArrayBuffer(DRACO_DECODER_WASM_BASE64) });
            this.worker = worker;
            return worker;
        } catch (error) {
            this.startError = new DracoUnavailableError(error instanceof Error ? error.message : String(error));
            throw this.startError;
        }
    }

    private failAll(error: Error): void {
        this.startError = error;
        this.worker?.terminate();
        this.worker = null;
        for (const task of this.tasks.values()) task.reject(error);
        this.tasks.clear();
    }

    /** The GLTFLoader-facing call, same signature as DRACOLoader.decodeDracoFile. */
    decodeDracoFile(
        buffer: ArrayBuffer,
        callback: (geometry: BufferGeometry) => void,
        attributeIDs: Record<string, number>,
        attributeTypes: Record<string, string>,
        _vertexColorSpace?: string,
        onError: (error: unknown) => void = () => undefined,
    ): Promise<void> {
        return this.decode(buffer, attributeIDs, attributeTypes).then(callback).catch(onError);
    }

    decode(buffer: ArrayBuffer, attributeIDs: Record<string, number>, attributeTypes: Record<string, string>): Promise<BufferGeometry> {
        return new Promise<WorkerGeometry>((resolve, reject) => {
            const worker = this.ensureWorker();
            const id = this.nextId++;
            this.tasks.set(id, { resolve, reject });
            // Copy: GLTFLoader may hand the same buffer view to several primitives.
            const copy = buffer.slice(0);
            worker.postMessage({ type: "decode", id, buffer: copy, attributeIDs, attributeTypes }, [copy]);
        }).then(toGeometry);
    }

    dispose(): void {
        this.failAll(new DracoUnavailableError("the decoder was disposed"));
        this.startError = null;
    }
}

function toGeometry(data: WorkerGeometry): BufferGeometry {
    const geometry = new BufferGeometry();
    if (data.index) geometry.setIndex(new BufferAttribute(data.index.array, 1));
    for (const { name, array, itemSize, stride } of data.attributes) {
        const attribute = itemSize === stride
            ? new BufferAttribute(array, itemSize)
            : new InterleavedBufferAttribute(new InterleavedBuffer(array, stride), itemSize, 0);
        // glTF vertex colours are already linear; integer colours are normalised.
        if (name === "color") attribute.normalized = !(array instanceof Float32Array);
        geometry.setAttribute(name, attribute);
    }
    return geometry;
}
