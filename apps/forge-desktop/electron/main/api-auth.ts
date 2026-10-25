import { randomBytes } from 'crypto'
import axios from 'axios'
import { session } from 'electron'

/**
 * Per-launch secret for the loopback FastAPI sidecar. Any web page can reach
 * 127.0.0.1, so the sidecar rejects every request that does not carry this
 * token (see api/access_control.py). It is generated fresh on each launch,
 * handed to uvicorn through the environment, and attached here to every
 * request this app sends to the sidecar: from the main process (axios and
 * fetch) and from the renderer (session request hook), so the renderer code
 * never handles it.
 */
export const API_TOKEN_HEADER = 'X-Forge-Token'
export const API_TOKEN = randomBytes(32).toString('hex')

/** Origins the renderer is served from: file:// reports "null"; dev uses the Vite server. */
export function allowedRendererOrigins(): string {
  const origins = ['null']
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    try {
      origins.push(new URL(devUrl).origin)
    } catch {
      // A malformed dev URL simply adds no origin.
    }
  }
  return origins.join(',')
}

export function installApiAuth(apiBaseUrl: string): void {
  const isSidecar = (url: string | undefined): boolean => !!url && url.startsWith(apiBaseUrl)

  axios.interceptors.request.use((config) => {
    const target = config.baseURL ? `${config.baseURL}${config.url ?? ''}` : config.url
    if (isSidecar(target)) config.headers.set(API_TOKEN_HEADER, API_TOKEN)
    return config
  })

  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isSidecar(url)) return nativeFetch(input, init)
    const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined))
    headers.set(API_TOKEN_HEADER, API_TOKEN)
    return nativeFetch(input, { ...init, headers })
  }) as typeof fetch

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${apiBaseUrl}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, [API_TOKEN_HEADER]: API_TOKEN } })
  })
}
