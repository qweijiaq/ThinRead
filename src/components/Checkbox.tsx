import type { JSX, ReactNode } from 'react'

interface CheckboxProps {
  checked: boolean
  onChange(checked: boolean): void
  label?: ReactNode
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
  ariaLabel,
}: CheckboxProps): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`ui-checkbox${checked ? ' is-on' : ''} ${className}`.trim()}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="ui-checkbox-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      {label ? <span className="ui-checkbox-label">{label}</span> : null}
    </button>
  )
}
