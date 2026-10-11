import { createPortal } from 'react-dom'

interface ConfirmModalProps {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps): JSX.Element {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm animate-fade-in" />

      {/* Modal */}
      <div className="relative w-80 rounded-2xl bg-zinc-900 border border-accent/20 shadow-2xl shadow-accent/5 overflow-hidden animate-slide-up-center">

        <div className="px-5 py-5 flex flex-col gap-4">

          {/* Icon + title */}
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              variant === 'danger'
                ? 'bg-accent/10 border border-accent/20'
                : 'bg-accent/10 border border-accent/20'
            }`}>
              {variant === 'danger' ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
            </div>

            <div className="flex flex-col gap-1 pt-0.5">
              <h2 className="text-base font-semibold text-zinc-100 leading-tight">{title}</h2>
              {description && (
                <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors border border-zinc-700/50"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-dark text-white text-sm font-semibold transition-colors shadow-lg shadow-accent/20"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
