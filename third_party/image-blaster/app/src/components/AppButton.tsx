import type { ButtonHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function AppButton({
  active,
  className = '',
  type = 'button',
  ...props
}: AppButtonProps) {
  return (
    <button
      type={type}
      className={twMerge(
        'inline-flex items-center text-xs gap-2 justify-start rounded px-2 py-1 opacity-80 transition-[background-color,opacity] hover:bg-white/10 hover:opacity-100',
        active && 'opacity-100',
        className,
      )}
      {...props}
    />
  )
}
