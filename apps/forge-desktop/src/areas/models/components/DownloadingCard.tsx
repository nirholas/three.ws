import { formatModelName } from '../utils'

interface Props {
  modelId: string
  percent: number
}

export function DownloadingCard({ modelId, percent }: Props): JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800">
      <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-light animate-bounce">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-zinc-200 truncate">{formatModelName(modelId)}</p>
          <span className="text-[10px] text-zinc-500 tabular-nums ml-2 shrink-0">{percent}%</span>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  )
}
