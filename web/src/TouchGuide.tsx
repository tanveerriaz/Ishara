export function TouchGuide() {
  return (
    <div className="touch-guide" role="status" aria-label="Graph touch controls">
      <div className="touch-guide__gesture touch-guide__gesture--pinch" aria-hidden>
        <span className="touch-guide__finger touch-guide__finger--left" />
        <span className="touch-guide__finger touch-guide__finger--right" />
        <span className="touch-guide__node" />
      </div>
      <p>
        <span>Pinch or double-tap to zoom</span>
        <span>Drag to move</span>
        <span>Tap a node to read</span>
      </p>
    </div>
  )
}
