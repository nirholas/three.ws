import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryObject } from '@shared/types/threeWs'

// The three.ws CC0 object library: free, public-domain models
// (the same catalog behind three.ws/objects) to drop into the viewer as a
// starting point, a reference, or a workflow input. No account needed.

const PAGE_SIZE = 36
const SEARCH_DEBOUNCE_MS = 300

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Thumb({ object }: { object: LibraryObject }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!object.thumb || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-600">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z" />
          <path d="M12 22V12M12 12l8.66-5M12 12L3.34 7" />
        </svg>
      </div>
    )
  }
  return <img src={object.thumb} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-contain" />
}

export default function ThreeWsLibraryPopover({
  onImport,
  onClose,
}: {
  /** Imports the downloaded .glb into the viewer; rejects with a readable error. */
  onImport: (filePath: string, object: LibraryObject) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [objects, setObjects] = useState<LibraryObject[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingUrl, setImportingUrl] = useState<string | null>(null)
  const requestId = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (q: string) => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    const res = q.trim()
      ? await window.electron.threews.librarySearch({ q: q.trim(), limit: PAGE_SIZE * 2 })
      : await window.electron.threews.libraryList({ offset: 0, limit: PAGE_SIZE })
    if (id !== requestId.current) return
    setLoading(false)
    if (res.ok) {
      setObjects(res.value.objects)
      setTotal(res.value.total)
    } else {
      setObjects([])
      setTotal(0)
      setError(res.error)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(query), query ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(id)
  }, [query, load])

  useEffect(() => { searchRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !importingUrl) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, importingUrl])

  async function loadMore(): Promise<void> {
    const id = requestId.current
    setLoadingMore(true)
    const res = await window.electron.threews.libraryList({ offset: objects.length, limit: PAGE_SIZE })
    if (id !== requestId.current) return
    setLoadingMore(false)
    if (res.ok) {
      const seen = new Set(objects.map((o) => o.url))
      setObjects([...objects, ...res.value.objects.filter((o) => !seen.has(o.url))])
      setTotal(res.value.total)
    } else {
      setError(res.error)
    }
  }

  async function pick(object: LibraryObject): Promise<void> {
    if (importingUrl) return
    setImportingUrl(object.url)
    setError(null)
    const res = await window.electron.threews.libraryDownload({ url: object.url, name: object.name })
    if (!res.ok) {
      setImportingUrl(null)
      setError(res.error)
      return
    }
    try {
      await onImport(res.value, object)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the model.')
    } finally {
      setImportingUrl(null)
    }
  }

  const searching = query.trim().length > 0
  const canLoadMore = !searching && !loading && objects.length < total

  return (
    <div
      role="dialog"
      aria-label="three.ws object library"
      className="absolute top-full left-0 mt-1 z-50 w-[420px] max-h-[70vh] bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-xl flex flex-col overflow-hidden"
    >
      <div className="p-3 border-b border-zinc-800 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-100">three.ws library</p>
          <span className="text-[10px] text-zinc-500">
            {loading ? 'Loading…' : searching ? `${objects.length} match${objects.length === 1 ? '' : 'es'}` : `${total.toLocaleString()} free CC0 models`}
          </span>
        </div>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chairs, trees, cars…"
          aria-label="Search the library"
          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
        />
      </div>

      {error && (
        <div role="alert" className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => void load(query)} className="shrink-0 text-red-200 hover:underline">Retry</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-3 gap-2" aria-busy="true">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-zinc-800/80 animate-pulse" />
            ))}
          </div>
        ) : objects.length === 0 && !error ? (
          <div className="py-10 text-center">
            <p className="text-xs text-zinc-300">Nothing matches “{query.trim()}”.</p>
            <p className="text-[11px] text-zinc-500 mt-1">Try a broader word, like “chair” instead of “office chair”.</p>
            <button type="button" onClick={() => setQuery('')} className="mt-3 text-[11px] text-accent-light hover:underline">Browse everything</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {objects.map((o) => {
                const busy = importingUrl === o.url
                return (
                  <button
                    key={o.url}
                    type="button"
                    onClick={() => void pick(o)}
                    disabled={!!importingUrl}
                    title={`${o.label}${o.bytes ? `, ${formatBytes(o.bytes)}` : ''}\n${o.license}${o.source ? `, ${o.source}` : ''}`}
                    className="group relative flex flex-col rounded-lg bg-zinc-800/60 border border-zinc-700/40 overflow-hidden text-left transition-colors hover:border-accent/60 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-light disabled:cursor-wait"
                  >
                    <div className={`aspect-square bg-zinc-900/60 transition-opacity ${importingUrl && !busy ? 'opacity-40' : ''}`}>
                      <Thumb object={o} />
                    </div>
                    <div className="px-1.5 py-1">
                      <p className="text-[10px] text-zinc-300 truncate">{o.label}</p>
                    </div>
                    {busy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/70">
                        <svg className="animate-spin text-accent-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            {canLoadMore && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="mt-3 w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 transition-colors disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : `Load more (${(total - objects.length).toLocaleString()} left)`}
              </button>
            )}
          </>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
        <span>Public domain (CC0). Free to use, remix and sell.</span>
        <button type="button" onClick={() => window.electron.threews.open('/objects')} className="hover:text-zinc-300">three.ws/objects</button>
      </div>
    </div>
  )
}
