import { useCallback, useEffect, useRef, useState } from 'react'

export type FocusMode = 'local' | 'global'

export type FocusSnap = {
  focusId: string | null
  mode: FocusMode
  query?: string
}

type IsharaHistoryState = FocusSnap & {
  ishara: true
  depth: number
}

function isIsharaState(raw: unknown): raw is IsharaHistoryState {
  return Boolean(raw && typeof raw === 'object' && (raw as IsharaHistoryState).ishara === true)
}

function buildUrl(id: string | null, slug?: string): string {
  const url = new URL(window.location.href)
  if (id && slug) {
    url.searchParams.set('focus', slug)
    url.searchParams.delete('id')
  } else if (id) {
    url.searchParams.set('id', id)
    url.searchParams.delete('focus')
  } else {
    url.searchParams.delete('focus')
    url.searchParams.delete('id')
  }
  return url.toString()
}

/**
 * Browser-backed focus history: pushState on user navigation, popstate restores.
 * In-app Back should call `goBack()` which uses `history.back()`.
 */
export function useFocusHistory(opts: {
  onRestore: (snap: FocusSnap) => void
  getSlug?: (id: string) => string | undefined
}) {
  const depthRef = useRef(0)
  const suppressingPop = useRef(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [prevTrail, setPrevTrail] = useState<string | null>(null)
  const trailStackRef = useRef<string[]>([])
  const onRestoreRef = useRef(opts.onRestore)
  onRestoreRef.current = opts.onRestore
  const getSlugRef = useRef(opts.getSlug)
  getSlugRef.current = opts.getSlug

  const syncCanGoBack = useCallback((depth: number) => {
    depthRef.current = depth
    setCanGoBack(depth > 0)
  }, [])

  const replaceFocus = useCallback(
    (snap: FocusSnap) => {
      const slug = snap.focusId ? getSlugRef.current?.(snap.focusId) : undefined
      const state: IsharaHistoryState = {
        ishara: true,
        depth: depthRef.current,
        focusId: snap.focusId,
        mode: snap.mode,
        query: snap.query,
      }
      try {
        window.history.replaceState(state, '', buildUrl(snap.focusId, slug))
      } catch {
        /* ignore */
      }
    },
    [],
  )

  const pushFocus = useCallback(
    (snap: FocusSnap, trailLabel?: string) => {
      const nextDepth = depthRef.current + 1
      const slug = snap.focusId ? getSlugRef.current?.(snap.focusId) : undefined
      const state: IsharaHistoryState = {
        ishara: true,
        depth: nextDepth,
        focusId: snap.focusId,
        mode: snap.mode,
        query: snap.query,
      }
      try {
        window.history.pushState(state, '', buildUrl(snap.focusId, slug))
      } catch {
        /* ignore */
      }
      syncCanGoBack(nextDepth)
      if (trailLabel) {
        trailStackRef.current = [...trailStackRef.current.slice(-23), trailLabel]
        setPrevTrail(trailLabel)
      }
    },
    [syncCanGoBack],
  )

  const goBack = useCallback(() => {
    if (depthRef.current <= 0) return false
    window.history.back()
    return true
  }, [])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (suppressingPop.current) return
      const state = e.state
      if (!isIsharaState(state)) {
        // Left our stack — treat as empty focus at depth 0
        syncCanGoBack(0)
        trailStackRef.current = []
        setPrevTrail(null)
        onRestoreRef.current({ focusId: null, mode: 'global' })
        return
      }
      syncCanGoBack(state.depth)
      const trail = trailStackRef.current
      if (trail.length) {
        trailStackRef.current = trail.slice(0, -1)
        setPrevTrail(trailStackRef.current[trailStackRef.current.length - 1] ?? null)
      } else {
        setPrevTrail(null)
      }
      onRestoreRef.current({
        focusId: state.focusId,
        mode: state.mode,
        query: state.query,
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [syncCanGoBack])

  /** Seed replaceState for first deep-link / boot without adding depth. */
  const seedInitial = useCallback(
    (snap: FocusSnap) => {
      syncCanGoBack(0)
      trailStackRef.current = []
      setPrevTrail(null)
      replaceFocus(snap)
    },
    [replaceFocus, syncCanGoBack],
  )

  return {
    canGoBack,
    prevTrail,
    pushFocus,
    replaceFocus,
    seedInitial,
    goBack,
    depthRef,
  }
}
