import { useEffect, useRef, useState, type JSX } from 'react'

import { renderShareCard, type ShareCardInput } from '../lib/share-card.js'

interface ShareCardPreviewProps {
  input: ShareCardInput
  width?: number
  className?: string
}

/**
 * 只依赖 renderShareCard 的纯展示组件：不经过 ShareDialog，也不需要 window.api。
 * 用于在 Storybook 里并列检查五种模板和 paper/ink 两套配色。
 */
export function ShareCardPreview({ input, width = 320, className = '' }: ShareCardPreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    function draw(): void {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        renderShareCard(canvas, input)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    draw()
    void document.fonts.ready.then(draw)
    return () => {
      cancelled = true
    }
  }, [input])

  return (
    <figure className={`share-card-preview ${className}`.trim()} style={{ margin: 0, width }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`分享卡预览：${input.title || input.quote}`}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          borderRadius: 18,
          boxShadow: '0 14px 34px rgba(35, 29, 20, 0.16)',
          background: 'var(--paper-3)',
        }}
      />
      {error ? (
        <figcaption style={{ marginTop: 8, color: 'var(--danger)', fontSize: 13 }} role="alert">
          {error}
        </figcaption>
      ) : null}
    </figure>
  )
}
