import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  children: React.ReactNode
}

export function Tooltip({ content, children }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  const show = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setCoords({
      x: rect.right + 10,
      y: rect.top + rect.height / 2,
    })
    setVisible(true)
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        className="inline-flex"
      >
        {children}
      </span>

      {visible &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{ left: coords.x, top: coords.y, transform: 'translateY(-50%)' }}
          >
            <div className="relative max-w-[220px] px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700/80 shadow-xl">
              {/* Arrow */}
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-zinc-700/80" />
              <div className="absolute right-full top-1/2 -translate-y-1/2 translate-x-px border-[5px] border-transparent border-r-zinc-900" />
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-normal">{content}</p>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
