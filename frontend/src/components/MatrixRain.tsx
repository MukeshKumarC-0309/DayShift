import { useEffect, useRef } from 'react'

/**
 * Terminal glyph rain, rendered to a canvas behind the app.
 *
 * Deliberately restrained: DESIGN.md rules out neon green-on-black, so this
 * uses the palette's muted terminal green (#3ecf8e) at low alpha, a slow fall
 * rate, and a sparse column grid. The intent is ambient texture you stop
 * noticing, not a screensaver competing with the data.
 *
 * Honours `prefers-reduced-motion` by rendering a single static frame, and
 * pauses entirely when the tab is hidden so it costs nothing in the background.
 */

interface Props {
  /** Peak opacity of the leading glyph, 0..1. */
  intensity?: number
  /** Pixel width of one column — larger is sparser. */
  columnWidth?: number
}

// Katakana half-width, digits, and a few operators — the classic alphabet,
// kept to characters that render in a monospace fallback.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>¦｜'

export default function MatrixRain({ intensity = 0.42, columnWidth = 18 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let columns = 0
    let drops: number[] = []
    let speeds: number[] = []
    let rafId = 0
    let lastDraw = 0

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const fontSize = Math.round(columnWidth * 0.8)

    function resize() {
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      columns = Math.ceil(width / columnWidth)
      drops = new Array(columns)
      speeds = new Array(columns)
      for (let i = 0; i < columns; i += 1) {
        // Stagger the start so columns do not fall in lockstep.
        drops[i] = Math.random() * -60
        speeds[i] = 0.22 + Math.random() * 0.5
      }
      ctx!.fillStyle = '#1a1d23'
      ctx!.fillRect(0, 0, width, height)
    }

    function glyph(): string {
      return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    }

    function draw(now: number) {
      rafId = requestAnimationFrame(draw)

      // Cap at ~24fps: the effect reads better slow, and it keeps the main
      // thread free for the dashboard.
      if (now - lastDraw < 42) return
      lastDraw = now

      // Fade the previous frame toward the base colour, leaving trails.
      ctx!.fillStyle = 'rgba(26, 29, 35, 0.11)'
      ctx!.fillRect(0, 0, width, height)
      ctx!.font = `${fontSize}px 'JetBrains Mono', ui-monospace, monospace`
      ctx!.textBaseline = 'top'

      for (let i = 0; i < columns; i += 1) {
        const y = drops[i] * fontSize
        if (y > -fontSize && y < height) {
          const x = i * columnWidth

          // Leading glyph: brightest, the muted terminal green.
          ctx!.fillStyle = `rgba(62, 207, 142, ${intensity})`
          ctx!.fillText(glyph(), x, y)

          // Two trailing glyphs, dimmer, so a column reads as a streak.
          ctx!.fillStyle = `rgba(62, 207, 142, ${intensity * 0.3})`
          ctx!.fillText(glyph(), x, y - fontSize)
          ctx!.fillStyle = `rgba(91, 157, 217, ${intensity * 0.12})`
          ctx!.fillText(glyph(), x, y - fontSize * 2)
        }

        drops[i] += speeds[i]
        // Recycle the column once it has fully left the viewport.
        if (y > height && Math.random() > 0.982) {
          drops[i] = Math.random() * -20
          speeds[i] = 0.22 + Math.random() * 0.5
        }
      }
    }

    function staticFrame() {
      ctx!.fillStyle = '#1a1d23'
      ctx!.fillRect(0, 0, width, height)
      ctx!.font = `${fontSize}px 'JetBrains Mono', ui-monospace, monospace`
      ctx!.textBaseline = 'top'
      for (let i = 0; i < columns; i += 1) {
        const runs = 1 + Math.floor(Math.random() * 3)
        for (let r = 0; r < runs; r += 1) {
          const y = Math.random() * height
          ctx!.fillStyle = `rgba(62, 207, 142, ${intensity * 0.25})`
          ctx!.fillText(glyph(), i * columnWidth, y)
        }
      }
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(rafId)
        rafId = 0
      } else if (!rafId && !reduceMotion) {
        rafId = requestAnimationFrame(draw)
      }
    }

    resize()
    if (reduceMotion) {
      staticFrame()
    } else {
      rafId = requestAnimationFrame(draw)
    }

    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intensity, columnWidth])

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20"
      />
      {/* Scrim: damps the rain so body text sitting directly on the background
          stays legible. Without it the glyphs compete with the data, which is
          the failure mode DESIGN.md is guarding against. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-base/70"
      />
    </>
  )
}
