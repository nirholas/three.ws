import { isDesktopRuntime, toRuntimeUrl } from '../services/runtime';

const isDev = import.meta.env.DEV;

// In production browser deployments, routes are handled by Vercel serverless functions.
// In local dev, Vite proxy handles these routes.
// In Tauri desktop mode, route requests need an absolute remote host.
export function proxyUrl(localPath: string): string {
  if (isDesktopRuntime()) {
    return toRuntimeUrl(localPath);
  }

  if (isDev) {
    return localPath;
  }

  return localPath;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithProxy(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(proxyUrl(url), {
      ...fetchInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
