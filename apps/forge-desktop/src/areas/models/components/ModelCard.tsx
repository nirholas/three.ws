import { LocalModel } from '../models'
import { formatModelName } from '../utils'

interface Props {
  model:      LocalModel
  onDelete:   () => void
  onGenerate: () => void
  disabled?:  boolean
}

export function ModelCard({ model, onDelete, onGenerate, disabled }: Props): JSX.Element {
  return (
    <div className="relative flex flex-col gap-2 px-3.5 py-4 rounded-2xl border transition-all min-h-[110px] bg-zinc-900/60 border-zinc-800 hover:border-zinc-700">
      {/* Open in explorer */}
      <button
        onClick={() => window.electron.model.showInFolder(model.id)}
        title="Show in explorer"
        className="absolute top-2.5 right-2.5 flex items-center justify-center w-6 h-6 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/60 transition-all"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      </button>

      {/* Name */}
      <p className="text-xs font-semibold leading-tight truncate text-zinc-200 pr-6">
        {formatModelName(model.id)}
      </p>

      {/* Size */}
      <span className="text-[11px] font-medium text-zinc-400">
        {model.size_gb > 0 ? `${model.size_gb} GB` : '—'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-auto">
        <button
          onClick={onGenerate}
          title="Use this model"
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-accent/20 border border-accent/25 text-accent-light hover:bg-accent/30 hover:border-accent/40 transition-all text-[10px] font-semibold"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Generate
        </button>
        <button
          onClick={onDelete}
          disabled={disabled}
          title={disabled ? 'Cannot delete while an install is in progress' : 'Uninstall'}
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-red-950/40 border border-red-900/30 text-red-500 hover:bg-red-900/50 hover:text-red-300 hover:border-red-700/50 transition-all shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-950/40 disabled:hover:text-red-500 disabled:hover:border-red-900/30"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
