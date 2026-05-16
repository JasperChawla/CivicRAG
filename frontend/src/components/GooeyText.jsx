import { useEffect, useRef } from 'react'

const WORDS = ['Congress', 'Questions', 'Government', 'Lawmakers', 'Representatives', 'Sources', 'Records', 'Officials']
const MORPH_TIME    = 1.2
const COOLDOWN_TIME = 2.5

const spanStyle = {
  position:   'absolute',
  top:        0,
  left:       '50%',
  transform:  'translateX(-50%)',
  width:      'max-content',
  textAlign:  'center',
  fontFamily: "'Georgia', 'Times New Roman', serif",
  fontSize:   'clamp(64px, 10vw, 140px)',
  fontWeight: 800,
  color:      '#ffffff',
  lineHeight: 1,
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

export default function GooeyText() {
  const text1Ref = useRef(null)
  const text2Ref = useRef(null)

  useEffect(() => {
    const t1 = text1Ref.current
    const t2 = text2Ref.current
    if (!t1 || !t2) return

    // t1 = currently shown word, t2 = next word to morph into
    let wordIndex = 0
    let time      = performance.now()
    let morph     = 0
    let cooldown  = COOLDOWN_TIME
    let phase     = 'cooldown'  // 'cooldown' | 'morph'

    t1.textContent = WORDS[wordIndex % WORDS.length]
    t2.textContent = WORDS[(wordIndex + 1) % WORDS.length]

    // fraction 0 → t1 fully visible, t2 invisible
    // fraction 1 → t1 invisible, t2 fully visible
    function setMorph(fraction) {
      t2.style.filter  = `blur(${Math.min(8 / fraction - 8, 100)}px)`
      t2.style.opacity = `${Math.pow(fraction, 0.4) * 100}%`
      const inv        = 1 - fraction
      t1.style.filter  = `blur(${Math.min(8 / inv - 8, 100)}px)`
      t1.style.opacity = `${Math.pow(inv, 0.4) * 100}%`
    }

    // Show t1 cleanly, hide t2 — called during cooldown and after morph swap
    function showCurrent() {
      t1.style.filter  = ''
      t1.style.opacity = '100%'
      t2.style.filter  = ''
      t2.style.opacity = '0%'
    }

    let rafId

    function animate() {
      rafId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt  = (now - time) / 1000
      time      = now

      if (phase === 'cooldown') {
        cooldown -= dt
        if (cooldown <= 0) {
          // Transition to morph; absorb overshoot as initial morph progress
          phase = 'morph'
          morph = -cooldown   // overshoot becomes morph head-start
          cooldown = 0
          setMorph(Math.min(morph / MORPH_TIME, 1))
        } else {
          showCurrent()
        }
      } else {
        // morph phase
        morph += dt
        if (morph >= MORPH_TIME) {
          // Morph complete — advance word NOW, before cooldown display begins
          // This prevents the old word (t1) ever reappearing at 100% opacity
          wordIndex++
          t1.textContent = WORDS[wordIndex % WORDS.length]       // word that just morphed in
          t2.textContent = WORDS[(wordIndex + 1) % WORDS.length] // next word to morph to
          phase    = 'cooldown'
          cooldown = COOLDOWN_TIME - (morph - MORPH_TIME)        // absorb overshoot
          morph    = 0
          showCurrent()
        } else {
          setMorph(morph / MORPH_TIME)
        }
      }
    }

    showCurrent()
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <>
      {/* SVG threshold filter: amplifies alpha so blurred overlapping glyphs solidify */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="threshold">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>

      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          position:       'relative',
          width:          '100%',
          height:         'clamp(80px, 12vw, 160px)',
          overflow:       'visible',
          filter:         'url(#threshold)',
        }}
      >
        <span ref={text1Ref} style={spanStyle} />
        <span ref={text2Ref} style={{ ...spanStyle, opacity: '0%' }} />
      </div>
    </>
  )
}
