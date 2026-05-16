import { motion } from 'framer-motion'
import GlowCard from './GlowCard'

function dotClass(score) {
  if (score > 0)  return 'dot-green'
  if (score >= -1) return 'dot-yellow'
  return 'dot-red'
}

function scoreToGlowColor(score) {
  if (score > 0)  return 'blue'
  if (score > -2) return 'purple'
  return 'red'
}

export default function SourceCards({ sources }) {
  if (!sources.length) return null

  return (
    <div className="sources-wrap">
      <div className="sources-label">Sources ({sources.length})</div>
      <div className="source-scroll">
        {sources.map((s, i) => (
          <GlowCard
            key={i}
            glowColor={scoreToGlowColor(s.rerank_score)}
            customSize
            style={{ flex: '0 0 200px' }}
          >
            <motion.div
              className="src-card"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
            >
              <div className="src-bill">{s.bill_number}</div>
              <div className="src-title">{s.title || '—'}</div>
              <div className="src-preview">{s.chunk_preview}</div>
              <div className="src-score-row">
                <span className={`score-dot ${dotClass(s.rerank_score)}`} />
                <span className="score-num">
                  {s.rerank_score > 0 ? '+' : ''}{s.rerank_score.toFixed(4)}
                </span>
              </div>
            </motion.div>
          </GlowCard>
        ))}
      </div>
    </div>
  )
}
