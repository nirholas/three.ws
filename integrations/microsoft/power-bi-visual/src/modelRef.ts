"use strict";

/**
 * Parses one cell of the Model data role into something the visual can load.
 *
 * Accepted forms:
 *   - a GLB (or glTF) URL on https://three.ws, for example
 *     https://three.ws/cdn/forge/anon/<id>.web.glb
 *   - a three.ws model page link, https://three.ws/m/<uuid>
 *   - a bare three.ws model id (uuid)
 *
 * Power BI only lets the visual reach the hosts declared in its WebAccess
 * privilege, so any other host is rejected here with an explanation instead of
 * failing later inside the host's content security policy.
 */

export const THREE_WS_ORIGIN = "https://three.ws";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_PAGE = /^\/m\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const ALLOWED_HOSTS = new Set(["three.ws", "www.three.ws"]);

export type ModelRef =
    | { kind: "url"; url: string }
    | { kind: "id"; id: string }
    | { kind: "invalid"; reason: string };

export function parseModelRef(raw: unknown): ModelRef {
    if (raw === null || raw === undefined) {
        return { kind: "invalid", reason: "This row has no model value." };
    }
    const text = String(raw).trim();
    if (text === "") {
        return { kind: "invalid", reason: "This row has no model value." };
    }
    if (UUID.test(text)) {
        return { kind: "id", id: text.toLowerCase() };
    }

    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return { kind: "invalid", reason: "Not a GLB URL or a three.ws model id." };
    }
    if (url.protocol !== "https:") {
        return { kind: "invalid", reason: "Model URLs must use https://." };
    }
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
        return {
            kind: "invalid",
            reason: `Power BI only lets this visual load models from ${THREE_WS_ORIGIN}. ${url.hostname} is blocked.`,
        };
    }

    const page = MODEL_PAGE.exec(url.pathname);
    if (page) {
        return { kind: "id", id: page[1].toLowerCase() };
    }
    return { kind: "url", url: `${THREE_WS_ORIGIN}${url.pathname}${url.search}` };
}

/** The three.ws page that opens a model in a full viewer. */
export function viewerUrlFor(ref: ModelRef): string | null {
    if (ref.kind === "id") return `${THREE_WS_ORIGIN}/m/${ref.id}`;
    if (ref.kind === "url") return `${THREE_WS_ORIGIN}/app?src=${encodeURIComponent(ref.url)}`;
    return null;
}

/** A short readable name for a model when no Category is bound. */
export function fallbackTitle(ref: ModelRef): string {
    if (ref.kind === "id") return `Model ${ref.id.slice(0, 8)}`;
    if (ref.kind === "url") {
        const file = ref.url.split("?")[0].split("/").pop() || "Model";
        return decodeURIComponent(file).replace(/\.(web\.)?(glb|gltf)$/i, "");
    }
    return "Model";
}
