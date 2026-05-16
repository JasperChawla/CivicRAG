import { useState } from 'react'
import { motion } from 'framer-motion'

const IMAGES = [
  'https://images.unsplash.com/photo-1555848962-6e79363ec58f?w=800', // A
  'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800', // S
  'https://images.unsplash.com/photo-1569025743873-ea3a9ade89f9?w=800', // K
  'https://images.unsplash.com/photo-1580128660010-fd027e1e587a?w=800', // C
  'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=800', // O
  'https://images.unsplash.com/photo-1617791160536-598cf32026fb?w=800', // N
  'https://images.unsplash.com/photo-1585776245991-cf89dd7fc73a?w=800', // G
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', // R
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800', // E
  'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=800', // S
  'https://images.unsplash.com/photo-1555848962-6e79363ec58f?w=800', // S
]

// Shared font properties applied identically to both layers
function fontStyle(fontSize) {
  return {
    fontSize,
    fontFamily: "'Georgia', 'Times New Roman', serif",
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: '-0.025em',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }
}

export default function RevealText({
  text = 'ASK CONGRESS',
  textColor = '#ffffff',
  overlayColor = '#4f8ef7',
  fontSize = 'clamp(48px, 8vw, 120px)',
  letterDelay = 0.08,
  overlayDelay = 0.05,
  overlayDuration = 0.4,
  springDuration = 600,
}) {
  const [hovered, setHovered] = useState(null)

  let imgIdx = 0
  const chars = text.split('').map(ch => ({
    ch,
    idx: ch === ' ' ? -1 : imgIdx++,
  }))

  const shared = fontStyle(fontSize)

  return (
    <motion.div
      style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'baseline' }}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: letterDelay } } }}
    >
      {chars.map(({ ch, idx }, i) =>
        ch === ' ' ? (
          <span key={i} style={{ display: 'inline-block', width: '0.32em' }} />
        ) : (
          <motion.span
            key={i}
            variants={{
              hidden: { opacity: 0, y: 40 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
              },
            }}
            style={{
              position: 'relative',
              display: 'inline-block',
              overflow: 'visible',
              cursor: 'default',
            }}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* ── Layer 1: Image clipped to letter shape ── */}
            <span
              style={{
                display: 'inline-block',
                ...shared,
                backgroundImage: `url(${IMAGES[idx]})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
                opacity: hovered === idx ? 1 : 0,
                transition: 'opacity 0.32s ease',
              }}
            >
              {ch}
            </span>

            {/* ── Layer 2: White letter on top — fades on hover ── */}
            <span
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'inline-block',
                ...shared,
                color: textColor,
                WebkitTextFillColor: textColor,
                opacity: hovered === idx ? 0 : 1,
                transition: 'opacity 0.32s ease',
                pointerEvents: 'none',
              }}
            >
              {ch}
            </span>
          </motion.span>
        )
      )}
    </motion.div>
  )
}
