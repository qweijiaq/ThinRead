import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange(value: string): void
  placeholder?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}

interface PopoverPosition {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  className = '',
  disabled = false,
  ariaLabel,
}: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options.find((option) => option.value === value)

  function openMenu(): void {
    if (disabled) return
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  function choose(option: SelectOption): void {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 190), Math.max(190, window.innerWidth - 16))
    const maxHeight = Math.min(300, Math.max(160, window.innerHeight - 24))
    const idealHeight = Math.min(options.length * 38 + 10, maxHeight)
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    if (below < idealHeight && above > below) {
      setPosition({ left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(maxHeight, above) })
    } else {
      setPosition({ left, width, top: rect.bottom + 4, maxHeight: Math.min(maxHeight, below) })
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    function onScroll(event: Event): void {
      if (popoverRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function onResize(): void {
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  function moveActive(delta: number): void {
    if (options.length === 0) return
    let next = activeIndex
    for (let step = 0; step < options.length; step++) {
      next = (next + delta + options.length) % options.length
      if (!options[next]?.disabled) break
    }
    setActiveIndex(next)
    optionRefs.current[next]?.focus()
  }

  return (
    <div className={`ui-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open ? setOpen(false) : openMenu()
          }
        }}
      >
        <span className={`ui-select-value${selected ? '' : ' is-placeholder'}`}>{selected?.label ?? placeholder}</span>
        <span className="ui-select-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 10" focusable="false">
            <path d="M2 2.5 8 8l6-5.5" />
          </svg>
        </span>
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="ui-select-popover"
              role="listbox"
              aria-label={ariaLabel}
              style={{
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }}
            >
              {options.map((option, index) => (
                <button
                  key={`${option.value}-${index}`}
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`ui-select-option${option.value === value ? ' is-selected' : ''}`}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveActive(1)
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveActive(-1)
                    } else if (event.key === 'Home') {
                      event.preventDefault()
                      setActiveIndex(0)
                      optionRefs.current[0]?.focus()
                    } else if (event.key === 'End') {
                      event.preventDefault()
                      setActiveIndex(options.length - 1)
                      optionRefs.current[options.length - 1]?.focus()
                    } else if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      choose(option)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setOpen(false)
                      triggerRef.current?.focus()
                    }
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <span className="ui-select-check">✓</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
