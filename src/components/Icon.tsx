import type { JSX } from 'react'

interface IconProps {
  size?: number
}

export function SparkleIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg className="od-icon-inline" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.6 2.2 7.7 5.3 10.8 6.4 7.7 7.5 6.6 10.6 5.5 7.5 2.4 6.4 5.5 5.3 6.6 2.2Z"
        fill="currentColor"
      />
      <path d="M12 9.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" fill="currentColor" opacity=".55" />
    </svg>
  )
}

export function ChevronIcon({ direction = 'right', size = 14 }: IconProps & { direction?: 'left' | 'right' }): JSX.Element {
  return (
    <svg className="od-icon-inline" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M9.8 4 6 8l3.8 4' : 'M6.2 4 10 8l-3.8 4'}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
