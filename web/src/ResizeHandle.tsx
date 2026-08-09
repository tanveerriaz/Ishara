import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

type Orientation = 'horizontal' | 'vertical'

type Props = {
  /** Desktop: vertical bar between panes. Stacked: horizontal bar. */
  orientation: Orientation
  onResize: (deltaPx: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  onActivate?: () => void
  expanded?: boolean
}

/**
 * Touch-friendly drag handle. Positive delta means "grow the note pane"
 * (drag left/up toward the graph).
 */
export function ResizeHandle({
  orientation,
  onResize,
  onResizeStart,
  onResizeEnd,
  onActivate,
  expanded,
}: Props) {
  const lastPos = useRef(0)
  const startPos = useRef(0)
  const pointerId = useRef<number | null>(null)
  const moved = useRef(false)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      pointerId.current = e.pointerId
      moved.current = false
      lastPos.current = orientation === 'vertical' ? e.clientX : e.clientY
      startPos.current = lastPos.current
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [orientation],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return
      const pos = orientation === 'vertical' ? e.clientX : e.clientY
      if (!moved.current) {
        if (Math.abs(pos - startPos.current) <= 12) return
        moved.current = true
        onResizeStart?.()
        const initialDelta = startPos.current - pos
        lastPos.current = pos
        onResize(initialDelta)
        return
      }
      const delta = lastPos.current - pos
      lastPos.current = pos
      if (Math.abs(delta) > 0) onResize(delta)
    },
    [onResizeStart, orientation, onResize],
  )

  useEffect(() => {
    const finishOutside = () => {
      if (pointerId.current == null) return
      pointerId.current = null
      if (moved.current) onResizeEnd?.()
      else onActivate?.()
    }
    window.addEventListener('pointerup', finishOutside)
    window.addEventListener('pointercancel', finishOutside)
    return () => {
      window.removeEventListener('pointerup', finishOutside)
      window.removeEventListener('pointercancel', finishOutside)
    }
  }, [onActivate, onResizeEnd])

  const end = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerId.current !== e.pointerId) return
      pointerId.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      if (moved.current) onResizeEnd?.()
      else onActivate?.()
    },
    [onActivate, onResizeEnd],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 80 : 32
      if (orientation === 'horizontal') {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          onResize(step)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          onResize(-step)
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(step)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(-step)
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate?.()
      }
    },
    [onActivate, onResize, orientation],
  )

  return (
    <div
      className={`resize-handle resize-handle--${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label="Resize note panel"
      aria-expanded={expanded}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      <span className="resize-handle__grip" aria-hidden />
    </div>
  )
}
