import { useEffect, useRef } from 'react'

const glowColorMap = {
  blue:   { base: 220, spread: 200 },
  purple: { base: 260, spread: 180 },
  red:    { base: 0,   spread: 200 },
}

export default function GlowCard({ children, glowColor = 'blue', customSize = false, style }) {
  const cardRef    = useRef(null)
  const overlayRef = useRef(null)

  useEffect(() => {
    function onMove(e) {
      const card    = cardRef.current
      const overlay = overlayRef.current
      if (!card || !overlay) return

      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // distance from cursor to nearest point inside the card
      const clampedX = Math.max(0, Math.min(x, rect.width))
      const clampedY = Math.max(0, Math.min(y, rect.height))
      const dist = Math.sqrt((x - clampedX) ** 2 + (y - clampedY) ** 2)
      const proximity = Math.max(0, 1 - dist / 150)

      const { base, spread } = glowColorMap[glowColor] ?? glowColorMap.blue

      overlay.style.background = proximity === 0
        ? 'none'
        : `radial-gradient(circle ${spread}px at ${x}px ${y}px, ` +
          `hsla(${base},90%,65%,${(proximity * 0.4).toFixed(3)}) 0%, transparent 100%)`
    }

    document.addEventListener('pointermove', onMove)
    return () => document.removeEventListener('pointermove', onMove)
  }, [glowColor])

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        borderRadius: 8,
        isolation: 'isolate',
        ...(customSize ? {} : { width: 200 }),
        ...style,
      }}
    >
      {children}
      {/* Glow overlay — rendered last so it composites above children */}
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: 'inherit',
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}
