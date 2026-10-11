import { net, shell } from 'electron'
import { createHash } from 'crypto'
import { hostname } from 'os'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { getSettings, setSettings } from './settings-store'
import { encryptSecretSync, decryptSecretSync } from './secure-store'
import { logger } from './logger'
import { AVATAR_VISIBILITIES } from '../../src/shared/types/threeWs'
import type {
  AvatarVisibility,
  DeviceLink,
  LibraryObject,
  LibraryPage,
  PublishResult,
  ThreeWsAccount,
} from '../../src/shared/types/threeWs'

export { AVATAR_VISIBILITIES }
export type { AvatarVisibility, DeviceLink, LibraryObject, LibraryPage, PublishResult, ThreeWsAccount }

/**
 * The three.ws account behind Forge: sign-in through the same device flow the
 * `three-ws` CLI uses (/api/cli/link, /api/cli/token), the resulting API key
 * stored encrypted at rest like the Hugging Face token, publishing a GLB to the
 * account (/api/avatars/upload then /api/avatars), and the CC0 object library
 * (/api/objects/library, /api/catalog).
 *
 * Every call runs in the main process through Electron's net stack, so the
 * renderer never sees the key and system proxies are honoured.
 */

export const THREE_WS_ORIGIN = (process.env.THREE_WS_BASE_URL || 'https://three.ws').replace(/\/+$/, '')

// Publishing needs avatars:write; profile lets whoami return the email and
// display name shown in Settings; generate unlocks the account's Forge tiers.
export const THREE_WS_SCOPE = 'profile avatars:read avatars:write generate'

const CLIENT_NAME = 'three.ws Forge'
const USER_AGENT = 'three-ws-forge-desktop'
// /api/avatars/upload proxies bodies up to 50 MB; larger files take the
// presigned path straight to storage. 500 MB is the per-avatar account limit.
const MAX_PROXY_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_AVATAR_BYTES = 500 * 1024 * 1024

export class ThreeWsError extends Error {
  constructor(message: string, readonly code = '', readonly status = 0) {
    super(message)
    this.name = 'ThreeWsError'
  }
}

const SIGNED_OUT: ThreeWsAccount = { signedIn: false, email: null, displayName: null, username: null, scope: '', keyPrefix: null, plan: null }

// ─── Key storage ─────────────────────────────────────────────────────────────

let cachedKey = ''

export function getThreeWsApiKey(): string {
  return cachedKey
}

/** Decrypt the stored key into the cache. Sync for the same reason as the HF
 *  token: process-runner builds child env synchronously. */
export function initThreeWsAccount(userData: string): void {
  const stored = getSettings(userData).threeWsApiKey ?? ''
  if (!stored) { cachedKey = ''; return }
  const decrypted = decryptSecretSync(stored)
  if (decrypted === null) {
    cachedKey = ''
    logger.error('[three-ws] the stored three.ws key could not be decrypted, sign in again in Settings → three.ws')
    return
  }
  cachedKey = decrypted
}

function storeKey(userData: string, key: string): void {
  cachedKey = key
  setSettings(userData, { threeWsApiKey: key ? encryptSecretSync(key) : '' })
}

export function signOut(userData: string): ThreeWsAccount {
  storeKey(userData, '')
  return SIGNED_OUT
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

interface RequestOptions {
  method?:  'GET' | 'POST' | 'PUT'
  body?:    unknown
  raw?:     Buffer
  headers?: Record<string, string>
  auth?:    boolean
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': USER_AGENT, ...opts.headers }
  if (opts.auth) {
    if (!cachedKey) throw new ThreeWsError('Sign in to three.ws first (Settings → three.ws).', 'signed_out', 401)
    headers.authorization = `Bearer ${cachedKey}`
  }
  let body: string | Uint8Array | undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  } else if (opts.raw) {
    body = new Uint8Array(opts.raw)
  }

  let res: Response
  try {
    res = await net.fetch(`${THREE_WS_ORIGIN}${path}`, { method: opts.method ?? 'GET', headers, body })
  } catch (err) {
    throw new ThreeWsError(`Could not reach ${THREE_WS_ORIGIN}: ${err instanceof Error ? err.message : String(err)}`, 'unreachable')
  }
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { error_description: text.slice(0, 300) } }
  if (!res.ok) {
    const message = String(parsed.error_description || parsed.message || parsed.error || `HTTP ${res.status}`)
    throw new ThreeWsError(message, String(parsed.error || ''), res.status)
  }
  return parsed as T
}

// ─── Account ─────────────────────────────────────────────────────────────────

interface WhoamiResponse {
  user:       { id: string; email?: string; display_name?: string | null; username?: string | null }
  plan:       { plan: string } | null
  credential: { scope: string; api_key: { prefix: string } | null }
}

export async function getAccount(userData: string): Promise<ThreeWsAccount> {
  if (!cachedKey) return SIGNED_OUT
  try {
    const me = await request<WhoamiResponse>('/api/cli/whoami', { auth: true })
    return {
      signedIn:    true,
      email:       me.user.email ?? null,
      displayName: me.user.display_name ?? null,
      username:    me.user.username ?? null,
      scope:       me.credential.scope,
      keyPrefix:   me.credential.api_key?.prefix ?? null,
      plan:        me.plan?.plan ?? null,
    }
  } catch (err) {
    // A revoked or expired key is dead weight: drop it so the UI offers a
    // fresh sign-in. Network trouble keeps it, the key is probably still good.
    if (err instanceof ThreeWsError && err.status === 401) {
      logger.warn('[three-ws] stored key was rejected, signing out')
      return signOut(userData)
    }
    throw err
  }
}

/** Save a pasted `sk_live_` key after checking that three.ws accepts it. */
export async function signInWithKey(userData: string, key: string): Promise<ThreeWsAccount> {
  const trimmed = key.trim()
  if (!trimmed) throw new ThreeWsError('Paste an API key from three.ws/dashboard/api.', 'missing_key')
  const previous = cachedKey
  cachedKey = trimmed
  try {
    const account = await getAccount(userData)
    if (!account.signedIn) throw new ThreeWsError('three.ws rejected that key. Check it was copied whole and has not been revoked.', 'invalid_token', 401)
    storeKey(userData, trimmed)
    return account
  } catch (err) {
    cachedKey = previous
    throw err
  }
}

// ─── Device sign-in ──────────────────────────────────────────────────────────

interface LinkResponse {
  device_code: string
  user_code: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

let activeLink: AbortController | null = null

export function cancelDeviceLink(): void {
  activeLink?.abort()
  activeLink = null
}

/**
 * Start a browser sign-in. Returns the code to show as soon as the link exists,
 * and resolves `done` once the browser approves (or rejects on deny/expiry).
 */
export async function startDeviceLink(userData: string): Promise<{ link: DeviceLink; done: Promise<ThreeWsAccount> }> {
  cancelDeviceLink()
  const controller = new AbortController()
  activeLink = controller

  const created = await request<LinkResponse>('/api/cli/link', {
    method: 'POST',
    body: { client_name: CLIENT_NAME, hostname: hostname().slice(0, 120), scope: THREE_WS_SCOPE },
  })
  await shell.openExternal(created.verification_uri_complete)

  const done = pollDeviceLink(userData, created, controller.signal).finally(() => {
    if (activeLink === controller) activeLink = null
  })
  return {
    link: { userCode: created.user_code, verificationUrl: created.verification_uri_complete, expiresIn: created.expires_in },
    done,
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ThreeWsError('Sign-in cancelled.', 'cancelled')); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new ThreeWsError('Sign-in cancelled.', 'cancelled'))
    }, { once: true })
  })
}

async function pollDeviceLink(userData: string, link: LinkResponse, signal: AbortSignal): Promise<ThreeWsAccount> {
  let interval = Math.max(1, link.interval) * 1000
  const deadline = Date.now() + link.expires_in * 1000
  while (Date.now() < deadline) {
    await wait(interval, signal)
    try {
      const token = await request<{ access_token: string }>('/api/cli/token', { method: 'POST', body: { device_code: link.device_code } })
      storeKey(userData, token.access_token)
      logger.info('[three-ws] signed in through the browser')
      return await getAccount(userData)
    } catch (err) {
      if (!(err instanceof ThreeWsError)) throw err
      if (err.code === 'authorization_pending') continue
      if (err.code === 'slow_down') { interval += 2000; continue }
      if (err.code === 'access_denied') throw new ThreeWsError('The sign-in was denied in the browser.', err.code, err.status)
      if (err.code === 'expired_token') throw new ThreeWsError('The sign-in code expired. Start again.', err.code, err.status)
      // Network blips while the user is in the browser: keep polling.
      if (err.code === 'unreachable') continue
      throw err
    }
  }
  throw new ThreeWsError('The sign-in code expired. Start again.', 'expired_token')
}

// ─── Publish ─────────────────────────────────────────────────────────────────

export interface PublishInput {
  glb:          Buffer
  name:         string
  description?: string
  visibility:   AvatarVisibility
  tags?:        string[]
  sourceMeta?:  Record<string, unknown>
}

export function isGlb(data: Buffer): boolean {
  return data.length >= 12
    && data.toString('latin1', 0, 4) === 'glTF'
    && data.readUInt32LE(4) === 2
    && data.readUInt32LE(8) === data.length
}

export function slugify(text: string): string {
  const slug = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64).replace(/[-_]+$/, '')
  return slug || 'model'
}

export function cleanTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 20)
}

export async function publishGlb(input: PublishInput): Promise<PublishResult> {
  const { glb } = input
  if (!isGlb(glb)) throw new ThreeWsError('That model is not a binary glTF 2.0 (.glb) file.', 'invalid_glb')
  if (glb.length > MAX_AVATAR_BYTES) throw new ThreeWsError('The model is larger than the 500 MB account limit. Decimate it first.', 'too_large')
  if (!AVATAR_VISIBILITIES.includes(input.visibility)) throw new ThreeWsError('Visibility must be private, unlisted or public.', 'invalid_visibility')

  const name = input.name.trim().slice(0, 120) || 'Untitled model'
  const slug = slugify(name)
  let checksum = createHash('sha256').update(glb).digest('hex')
  let storageKey: string | undefined
  let sizeBytes = glb.length

  if (glb.length <= MAX_PROXY_UPLOAD_BYTES) {
    const query = new URLSearchParams({ slug, content_type: 'model/gltf-binary', sha256: checksum })
    const stored = await request<{ storage_key?: string; size_bytes?: number; checksum_sha256?: string }>(
      `/api/avatars/upload?${query}`,
      { method: 'POST', raw: glb, headers: { 'content-type': 'model/gltf-binary' }, auth: true },
    )
    storageKey = stored.storage_key
    sizeBytes = stored.size_bytes ?? glb.length
    checksum = stored.checksum_sha256 ?? checksum
  } else {
    const presign = await request<{ storage_key?: string; upload_url?: string; headers?: Record<string, string> }>('/api/avatars/presign', {
      method: 'POST',
      body: { size_bytes: glb.length, content_type: 'model/gltf-binary', checksum_sha256: checksum, slug },
      auth: true,
    })
    if (!presign.storage_key || !presign.upload_url) throw new ThreeWsError('three.ws returned no upload URL.', 'presign_failed')
    const put = await net.fetch(presign.upload_url, {
      method: 'PUT',
      headers: presign.headers ?? { 'content-type': 'model/gltf-binary' },
      body: new Uint8Array(glb),
    })
    if (!put.ok) throw new ThreeWsError(`The model upload failed (HTTP ${put.status}).`, 'upload_failed', put.status)
    storageKey = presign.storage_key
  }
  if (!storageKey) throw new ThreeWsError('three.ws returned no storage key for the upload.', 'upload_failed')

  const body: Record<string, unknown> = {
    name,
    storage_key:     storageKey,
    size_bytes:      sizeBytes,
    content_type:    'model/gltf-binary',
    checksum_sha256: checksum,
    visibility:      input.visibility,
    tags:            cleanTags(input.tags),
    source:          'upload',
    source_meta:     { client: 'three.ws Forge', ...input.sourceMeta },
  }
  const description = input.description?.trim()
  if (description) body.description = description.slice(0, 2000)

  const created = await request<{ avatar?: { id?: string; name?: string; visibility?: string } }>('/api/avatars', { method: 'POST', body, auth: true })
  const avatar = created.avatar
  if (!avatar?.id) throw new ThreeWsError('three.ws did not return the saved model.', 'create_failed')
  return {
    id:         avatar.id,
    name:       avatar.name ?? name,
    visibility: avatar.visibility ?? input.visibility,
    url:        `${THREE_WS_ORIGIN}/avatars/${encodeURIComponent(avatar.id)}`,
  }
}

// ─── CC0 object library ──────────────────────────────────────────────────────

function toLibraryObject(raw: Record<string, unknown>): LibraryObject | null {
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (!/^https:\/\//.test(url)) return null
  const name = String(raw.name ?? '')
  return {
    name,
    label:      String(raw.label ?? raw.title ?? name),
    url,
    thumb:      typeof raw.thumb === 'string' ? raw.thumb : null,
    bytes:      typeof raw.bytes === 'number' ? raw.bytes : null,
    categories: Array.isArray(raw.categories) ? raw.categories.map(String) : [],
    tags:       Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    license:    String(raw.license ?? 'CC0'),
    source:     typeof raw.source === 'string' ? raw.source : null,
  }
}

export async function listLibrary(offset: number, limit: number): Promise<LibraryPage> {
  const query = new URLSearchParams({ offset: String(Math.max(0, offset)), limit: String(Math.min(Math.max(1, limit), 100)) })
  const page = await request<{ objects?: Record<string, unknown>[]; total?: number }>(`/api/objects/library?${query}`)
  const objects = (page.objects ?? []).map(toLibraryObject).filter((o): o is LibraryObject => o !== null)
  return { objects, total: page.total ?? objects.length }
}

export async function searchLibrary(q: string, limit: number): Promise<LibraryPage> {
  const query = new URLSearchParams({ q: q.trim().slice(0, 120), kind: 'object', limit: String(Math.min(Math.max(1, limit), 50)) })
  const page = await request<{ items?: Record<string, unknown>[]; matched?: number }>(`/api/catalog?${query}`)
  const objects = (page.items ?? []).map(toLibraryObject).filter((o): o is LibraryObject => o !== null)
  return { objects, total: page.matched ?? objects.length }
}

/** Download one library object into `dir` and return the local path. */
export async function downloadLibraryObject(object: Pick<LibraryObject, 'url' | 'name'>, dir: string): Promise<string> {
  const url = new URL(object.url)
  if (url.protocol !== 'https:') throw new ThreeWsError('Library objects are only fetched over HTTPS.', 'invalid_url')
  const res = await net.fetch(url.toString(), { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new ThreeWsError(`Could not download ${object.name} (HTTP ${res.status}).`, 'download_failed', res.status)
  const data = Buffer.from(await res.arrayBuffer())
  if (!isGlb(data)) throw new ThreeWsError(`${object.name} is not a valid GLB file.`, 'invalid_glb')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${slugify(object.name)}.glb`)
  await writeFile(file, data)
  return file
}
