import { ipcMain, app, shell } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { API_BASE_URL } from './python-bridge'
import { logger } from './logger'
import {
  THREE_WS_ORIGIN,
  ThreeWsError,
  cancelDeviceLink,
  downloadLibraryObject,
  getAccount,
  getThreeWsApiKey,
  initThreeWsAccount,
  listLibrary,
  publishGlb,
  searchLibrary,
  signInWithKey,
  signOut,
  startDeviceLink,
  type LibraryObject,
} from './three-ws-account'
import type { PublishRequest, ThreeWsResult } from '../../src/shared/types/threeWs'

type WindowGetter = () => Electron.BrowserWindow | null


// IPC errors lose their class across the bridge, so each handler returns a
// tagged result the renderer can show as-is.
async function wrap<T>(label: string, fn: () => Promise<T>): Promise<ThreeWsResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = err instanceof ThreeWsError ? err.code : ''
    if (code !== 'cancelled') logger.warn(`[three-ws] ${label} failed: ${message}`)
    return { ok: false, error: message, code }
  }
}

// The cloud generator runs inside the FastAPI process, which was spawned with
// whatever key existed at launch. Push changes so it never needs a restart.
async function syncBackendKey(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/settings/three-ws`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ api_key: getThreeWsApiKey(), base_url: THREE_WS_ORIGIN }),
      signal:  AbortSignal.timeout(3000),
    })
  } catch (err) {
    // Not started yet: it reads the key from its spawn env when it does.
    logger.info(`[three-ws] backend key sync skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Read a model the local backend serves (a /workspace/... or /optimize/... URL). */
async function readLocalModel(outputUrl: string): Promise<Buffer> {
  if (!outputUrl.startsWith('/')) throw new ThreeWsError('Only models in the Forge workspace can be published.', 'invalid_source')
  const res = await fetch(`${API_BASE_URL}${outputUrl}`)
  if (!res.ok) throw new ThreeWsError(`Could not read the model from the local backend (HTTP ${res.status}).`, 'read_failed', res.status)
  return Buffer.from(await res.arrayBuffer())
}

export function registerThreeWsIpcHandlers(getWindow: WindowGetter): void {
  const userData = app.getPath('userData')
  initThreeWsAccount(userData)

  ipcMain.handle('threews:origin', () => THREE_WS_ORIGIN)

  ipcMain.handle('threews:account', () => wrap('account', () => getAccount(userData)))

  ipcMain.handle('threews:signInWithKey', (_e, key: string) =>
    wrap('sign-in with key', async () => {
      const account = await signInWithKey(userData, String(key ?? ''))
      await syncBackendKey()
      return account
    }))

  ipcMain.handle('threews:signOut', () => wrap('sign-out', async () => {
    const account = signOut(userData)
    await syncBackendKey()
    return account
  }))

  // Starts the browser sign-in and answers with the code right away; the
  // outcome arrives later as a threews:linkResult event.
  ipcMain.handle('threews:startLink', () => wrap('start sign-in', async () => {
    const { link, done } = await startDeviceLink(userData)
    done.then(
      async (account) => {
        await syncBackendKey()
        getWindow()?.webContents.send('threews:linkResult', { ok: true, value: account })
      },
      (err: unknown) => {
        const code = err instanceof ThreeWsError ? err.code : ''
        if (code === 'cancelled') return
        getWindow()?.webContents.send('threews:linkResult', { ok: false, error: err instanceof Error ? err.message : String(err), code })
      },
    )
    return link
  }))

  ipcMain.handle('threews:cancelLink', () => { cancelDeviceLink() })

  ipcMain.handle('threews:publish', (_e, args: PublishRequest) =>
    wrap('publish', async () => {
      const glb = await readLocalModel(String(args?.outputUrl ?? ''))
      return publishGlb({
        glb,
        name:        String(args.name ?? ''),
        description: args.description,
        visibility:  args.visibility,
        tags:        Array.isArray(args.tags) ? args.tags.map(String) : [],
        sourceMeta:  { app_version: app.getVersion() },
      })
    }))

  ipcMain.handle('threews:libraryList', (_e, args: { offset?: number; limit?: number }) =>
    wrap('library list', () => listLibrary(Number(args?.offset ?? 0), Number(args?.limit ?? 48))))

  ipcMain.handle('threews:librarySearch', (_e, args: { q: string; limit?: number }) =>
    wrap('library search', () => searchLibrary(String(args?.q ?? ''), Number(args?.limit ?? 48))))

  ipcMain.handle('threews:libraryDownload', (_e, object: Pick<LibraryObject, 'url' | 'name'>) =>
    wrap('library download', () => downloadLibraryObject(object, join(tmpdir(), 'three-ws-forge-library'))))

  // Only three.ws pages: the renderer opens published models and the dashboard.
  ipcMain.handle('threews:open', (_e, path: string) => {
    const url = new URL(String(path ?? '/'), THREE_WS_ORIGIN)
    if (url.origin !== new URL(THREE_WS_ORIGIN).origin) return
    void shell.openExternal(url.toString())
  })
}
