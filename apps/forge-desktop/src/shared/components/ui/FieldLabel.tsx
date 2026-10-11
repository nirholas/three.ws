import { Tooltip } from './Tooltip'

interface FieldLabelProps {
  label: string
  tooltip?: string
  children?: React.ReactNode
}

export function FieldLabel({ label, tooltip, children }: FieldLabelProps): JSX.Element {
  return (
    <div className="flex items-center w-full">
      <span className="text-sm text-zinc-300">{label}</span>
      {children && <span className="ml-1.5 text-xs text-zinc-600">{children}</span>}
      {tooltip && (
        <span className="ml-auto">
        <Tooltip content={tooltip}>
          <span className="w-5 h-5 rounded-full flex items-center justify-center text-zinc-600 hover:text-accent-light transition-colors cursor-default select-none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
        </Tooltip>
        </span>
      )}
    </div>
  )
}
