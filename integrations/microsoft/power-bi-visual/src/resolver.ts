"use strict";

import { ModelRef, THREE_WS_ORIGIN } from "./modelRef";
import { t } from "./strings";

/**
 * Turns a parsed model reference into the GLB URLs to try, in order.
 *
 * Ids resolve through the public by-id read behind three.ws/m/<id>,
 * GET /api/forge-creation?id=<uuid> (documented in docs/api-reference.md). The
 * web-optimised GLB (meshopt + WebP) is tried first because it is several times
 * smaller; the original GLB is the fallback when the optimised file cannot be
 * decoded in the host.
 */

export interface ResolvedModel {
    urls: string[];
    title: string | null;
}

export class ModelLoadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ModelLoadError";
    }
}

interface CreationResponse {
    creation?: {
        glb_url?: string | null;
        web_glb_url?: string | null;
        prompt?: string | null;
    } | null;
}

const MAX_TITLE = 60;

function shortTitle(prompt: string | null | undefined): string | null {
    if (!prompt) return null;
    const clean = prompt.replace(/\s+/g, " ").trim();
    if (clean.length <= MAX_TITLE) return clean;
    return `${clean.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

export class ModelResolver {
    private readonly cache = new Map<string, Promise<ResolvedModel>>();

    constructor(private readonly origin: string = THREE_WS_ORIGIN) {}

    resolve(ref: ModelRef): Promise<ResolvedModel> {
        if (ref.kind === "invalid") return Promise.reject(new ModelLoadError(ref.reason));
        if (ref.kind === "url") return Promise.resolve({ urls: [ref.url], title: null });

        const cached = this.cache.get(ref.id);
        if (cached) return cached;
        const pending = this.lookup(ref.id).catch((error: unknown) => {
            // Failures are not cached, so Retry on the tile asks again.
            this.cache.delete(ref.id);
            throw error;
        });
        this.cache.set(ref.id, pending);
        return pending;
    }

    private async lookup(id: string, attempt = 0): Promise<ResolvedModel> {
        let response: Response;
        try {
            response = await fetch(`${this.origin}/api/forge-creation?id=${encodeURIComponent(id)}`, {
                credentials: "omit",
                headers: { accept: "application/json" },
            });
        } catch {
            throw new ModelLoadError(t("Err_LookupUnreachable"));
        }

        if (response.status === 429 && attempt === 0) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2000);
            return this.lookup(id, attempt + 1);
        }
        if (response.status === 404) {
            throw new ModelLoadError(t("Err_LookupNotFound", id));
        }
        if (!response.ok) {
            throw new ModelLoadError(t("Err_LookupFailed", response.status));
        }

        const body = (await response.json()) as CreationResponse;
        const creation = body.creation;
        const candidates = [creation?.web_glb_url, creation?.glb_url].filter(
            (u, i, all): u is string => typeof u === "string" && u !== "" && all.indexOf(u) === i,
        );
        if (!creation || candidates.length === 0) {
            throw new ModelLoadError(t("Err_NoGlb", id));
        }
        const urls = candidates.filter((u) => u.startsWith(`${this.origin}/`));
        if (urls.length === 0) {
            throw new ModelLoadError(t("Err_StoredElsewhere", id, this.origin));
        }
        return { urls, title: shortTitle(creation.prompt) };
    }
}
