import { useEffect, useState, useCallback } from 'react'

const LOG_FILES = [
  { id: 'errors.log',  label: 'Errors',  description: 'All errors from Electron and Python' },
  { id: 'runtime.log', label: 'Runtime', description: 'FastAPI / Python output' },
  { id: 'modly.log',   label: 'App',     description: 'General Electron logs' },
]

function formatSession(id: string): string {
  // id format: 2026-03-20T10-23-45
  try {
    const iso = id.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3')
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return id
  }
}

export function LogsSection(): JSX.Element {
  const [sessions, setSessions] = useState<string[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(null) // null = current
  const [activeFile, setActiveFile] = useState('errors.log')
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const loadSessions = useCallback(async () => {
    const list = await window.electron.log.listSessions()
    setSessions(list)
  }, [])

  const loadLogs = useCallback(async (session: string | null) => {
    setLoading(true)
    const result = await window.electron.log.readAll(session ?? undefined)
    setLogs(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadSessions()
    loadLogs(null)
  }, [loadSessions, loadLogs])

  const handleSessionChange = (value: string) => {
    const session = value === 'current' ? null : value
    setActiveSession(session)
    loadLogs(session)
  }

  const handleRefresh = () => {
    loadSessions()
    loadLogs(activeSession)
  }

  const content = logs[activeFile] ?? ''

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Logs</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Application log files — share these when reporting issues.</p>
      </div>

      {/* Session selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-500 shrink-0">Session</label>
        <select
          value={activeSession ?? 'current'}
          onChange={(e) => handleSessionChange(e.target.value)}
          className="flex-1 bg-zinc-800/80 border border-zinc-700/60 text-zinc-200 text-xs rounded-lg px-3 py-2 outline-none focus:border-zinc-600"
        >
          <option value="current">Current session</option>
          {sessions.map((s) => (
            <option key={s} value={s}>{formatSession(s)}</option>
          ))}
        </select>
      </div>

      {/* File tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        {LOG_FILES.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFile(f.id)}
            title={f.description}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeFile === f.id
                ? 'border-accent text-accent-light'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 pb-1">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
          <button
            onClick={handleCopy}
            disabled={!content}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-zinc-700/60 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy all'}
          </button>
        </div>
      </div>

      {/* Log content */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">Loading…</div>
      ) : content ? (
        <pre className="text-[11px] font-mono text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words select-text leading-relaxed">
          {content}
        </pre>
      ) : (
        <div className="flex items-center justify-center h-48 text-zinc-600 text-xs border border-zinc-800 rounded-xl">
          No entries in {activeFile}
        </div>
      )}
    </div>
  )
}
