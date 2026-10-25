import type { ReactNode } from 'react'
import { Cube } from '@phosphor-icons/react'
import { twMerge } from 'tailwind-merge'

export const chrome = {
  enter: 'chrome-enter',
  panel: 'rounded border border-white/15 bg-black/70 shadow-lg backdrop-blur-md',
  bar: 'rounded border border-white/15 bg-black/70 p-1 shadow-lg backdrop-blur-md',
  sectionHeader: 'flex items-center justify-between border-b border-white/10 px-2 py-1 text-xs font-sm tracking-wide text-white/55',
  row: 'group flex items-center gap-1 rounded transition-[background-color,opacity]',
  rowIdle: 'opacity-80 hover:bg-white/10 hover:opacity-100',
  rowActive: 'bg-white/15 opacity-100',
  divider: 'h-6 w-px bg-white/15',
  iconButton: 'h-8 w-8 justify-center',
}

export function ChromePanel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={twMerge(chrome.panel, className)}>{children}</div>
}

export function ChromeThumbnail({
  thumbnailUrl,
  alt = '',
}: {
  thumbnailUrl?: string
  alt?: string
}) {
  if (!thumbnailUrl) {
    return (
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-white/10 text-white/35 ring-1 ring-white/10">
        <Cube size={14} weight="regular" />
      </span>
    )
  }

  return (
    <span className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded bg-white/10 ring-1 ring-white/10">
      <img src={thumbnailUrl} alt={alt} className="h-full w-full object-cover" />
    </span>
  )
}
