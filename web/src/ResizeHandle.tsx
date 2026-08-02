import { useCallback, useRef, type PointerEvent } from 'react'

type Orientation = 'horizontal' | 'vertical'

type Props = {
  /** Desktop: vertical bar between panes. Stacked: horizontal bar. */
  orientation: Orientation
  onResize: (deltaPx: number) => void
  onResizeEnd?: () => void
}

/**
 * Touch-friendly drag handle. Positive delta means "grow the note pane"
 * (drag left/up toward the graph).
 */
export function ResizeHandle({ orientation, onResize, onResizeEnd }: Props) {
  const lastPos = useRef(0)
  const pointerId = useRef<number | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      pointerId.current = e.pointerId
      lastPos.current = orientation === 'vertical' ? e.clientX : e.clientY
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [orientation],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return
      const pos = orientation === 'vertical' ? e.clientX : e.clientY
      const delta = lastPos.current - pos
      lastPos.current = pos
      if (delta !== 0) onResize(delta)
    },
    [orientation, onResize],
  )

  const end = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return
      pointerId.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      onResizeEnd?.()
    },
    [onResizeEnd],
  )

  return (
    <div
      className={`resize-handle resize-handle--${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label="Resize note panel"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="resize-handle__grip" aria-hidden />
    </div>
  )
}
