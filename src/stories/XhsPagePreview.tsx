import { useEffect, useRef, useState, type JSX } from 'react'

import type { XhsCarouselPlan, XhsTheme } from '../lib/xhs-carousel.js'
import { renderXhsPage } from '../lib/xhs-carousel.js'

interface XhsPagePreviewProps {
  plan: XhsCarouselPlan
  pageIndex: number
  theme?: XhsTheme
  width?: number
}

/** 只用于 Storybook / 视觉检查：把单张小红书页面画到 canvas。 */
export function XhsPagePreview({ plan, pageIndex, theme = 'paper', width = 280 }: XhsPagePreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      renderXhsPage(canvas, plan, pageIndex, theme)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [plan, pageIndex, theme])

  return (
    <figure style={{ margin: 0, width }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: 'auto', boxShadow: '0 18px 40px rgba(30, 26, 20, 0.16)' }}
      />
      {error ? <figcaption style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</figcaption> : null}
    </figure>
  )
}
