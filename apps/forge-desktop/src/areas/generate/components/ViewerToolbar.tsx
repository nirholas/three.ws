import type { ViewMode } from '../models'
export type { ViewMode }

interface ViewerToolbarProps {
  viewMode: ViewMode
  autoRotate: boolean
  onViewMode: (mode: ViewMode) => void
  onAutoRotate: () => void
  onScreenshot: () => void
  showViewModes?: boolean   // view modes are mesh-only; hidden for splats
}

const MODES: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  {
    mode: 'solid',
    label: 'Solid',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    mode: 'wireframe',
    label: 'Wireframe',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    mode: 'normals',
    label: 'Normals',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
      </svg>
    ),
  },
  {
    mode: 'matcap',
    label: 'Matcap',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 10 Q10 7 12 10 Q14 13 16 10" />
      </svg>
    ),
  },
  {
    mode: 'uv',
    label: 'UV Checker',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <rect x="3" y="3" width="9" height="9" fill="currentColor" fillOpacity="0.3" />
        <rect x="12" y="12" width="9" height="9" fill="currentColor" fillOpacity="0.3" />
      </svg>
    ),
  },
]

export function ViewerToolbar({
  viewMode,
  autoRotate,
  onViewMode,
  onAutoRotate,
  onScreenshot,
  showViewModes = true,
}: ViewerToolbarProps): JSX.Element {
  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 bg-zinc-900/70 border border-zinc-700/50 backdrop-blur-sm rounded-xl p-1.5">
      {showViewModes && MODES.map(({ mode, icon, label }) => (
        <ToolbarButton
          key={mode}
          active={viewMode === mode}
          label={label}
          onClick={() => onViewMode(mode)}
        >
          {icon}
        </ToolbarButton>
      ))}

      {showViewModes && <div className="my-1 border-t border-zinc-700/50" />}

      <ToolbarButton
        active={autoRotate}
        label="Auto-rotate"
        onClick={onAutoRotate}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </ToolbarButton>

      <ToolbarButton
        active={false}
        label="Screenshot"
        onClick={onScreenshot}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </ToolbarButton>
    </div>
  )
}

interface ToolbarButtonProps {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ active, label, onClick, children }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`
        relative w-8 h-8 flex items-center justify-center rounded-lg transition-colors
        ${active
          ? 'bg-violet-600 text-white'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60'
        }
      `}
    >
      {children}
    </button>
  )
}
