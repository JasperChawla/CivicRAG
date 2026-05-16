import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import GlowCard from './GlowCard'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (target === null || target === undefined) { setValue(0); return }
    const start = performance.now()
    const from = 0

    function step(now) {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(from + (target - from) * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}

function metricClass(val) {
  if (val === null || val === undefined) return 'metric-neutral'
  if (val > 0.7) return 'metric-green'
  if (val > 0.4) return 'metric-yellow'
  return 'metric-red'
}

function numClass(val) {
  if (val === null || val === undefined) return 'num-neutral'
  if (val > 0.7) return 'num-green'
  if (val > 0.4) return 'num-yellow'
  return 'num-red'
}

function bucketBadgeClass(bucket) {
  switch (bucket) {
    case 'ok':             return 'bkt-ok'
    case 'hallucination':  return 'bkt-hall'
    case 'retrieval_miss': return 'bkt-ret'
    case 'latency':        return 'bkt-lat'
    default:               return 'bkt-na'
  }
}

function avg(arr, key) {
  const vals = arr.map(r => r[key]).filter(v => v !== null && v !== undefined)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function mostCommon(items) {
  if (!items.length) return null
  const counts = {}
  items.forEach(x => { counts[x] = (counts[x] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

function metricToGlowColor(val) {
  if (val === null || val === undefined) return 'blue'
  if (val > 0.7) return 'blue'
  if (val > 0.4) return 'purple'
  return 'red'
}

function StatBlock({ label, value, isText, glowColor = 'blue' }) {
  const animated = useCountUp(isText ? null : value)

  const inner = isText ? (
    <div className="stat-block">
      <span className="stat-number num-accent" style={{ fontSize: 40, letterSpacing: '-0.02em' }}>
        {value ?? '—'}
      </span>
      <span className="stat-lbl">{label}</span>
    </div>
  ) : (
    <div className="stat-block">
      <span className={`stat-number ${numClass(value)}`}>
        {value !== null && value !== undefined ? animated.toFixed(2) : '—'}
      </span>
      <span className="stat-lbl">{label}</span>
    </div>
  )

  return (
    <GlowCard glowColor={glowColor} customSize>
      {inner}
    </GlowCard>
  )
}

const BUCKETS = [
  { key: 'ok',             label: 'OK',             cls: 'fill-green'  },
  { key: 'hallucination',  label: 'Hallucination',  cls: 'fill-red'    },
  { key: 'retrieval_miss', label: 'Retrieval Miss', cls: 'fill-yellow' },
  { key: 'latency',        label: 'Latency',        cls: 'fill-blue'   },
]

function BucketChart({ counts }) {
  const maxCount = Math.max(...BUCKETS.map(b => counts[b.key] || 0), 1)
  return (
    <div className="bucket-bars">
      {BUCKETS.map((b, i) => {
        const count = counts[b.key] || 0
        const pct = (count / maxCount) * 100
        return (
          <div key={b.key} className="b-row">
            <span className="b-label">{b.label}</span>
            <div className="b-track">
              <motion.div
                className={`b-fill ${b.cls}`}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
              />
            </div>
            <span className="b-count">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function EvalDashboard() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)

  async function fetchHistory() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/eval/history`)
      if (res.ok) { setHistory(await res.json()); setLastRefresh(new Date()) }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchHistory()
    const id = setInterval(fetchHistory, 30000)
    return () => clearInterval(id)
  }, [])

  const avgFaith  = avg(history, 'faithfulness')
  const avgRel    = avg(history, 'answer_relevancy')
  const avgRecall = avg(history, 'context_recall')
  const topBucket = mostCommon(history.map(h => h.loss_bucket).filter(Boolean))

  const bucketCounts = { ok: 0, hallucination: 0, retrieval_miss: 0, latency: 0 }
  history.forEach(h => { if (h.loss_bucket in bucketCounts) bucketCounts[h.loss_bucket]++ })

  return (
    <div className="eval-page">
      <div className="eval-header-row">
        <span className="eval-title">RAGAS Eval Metrics</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="eval-refresh-info">
            {loading ? 'Refreshing…' : lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : ''}
          </span>
          <button className="refresh-btn" onClick={fetchHistory} title="Refresh">↻</button>
        </div>
      </div>

      <div className="stat-grid">
        <StatBlock label="Avg Faithfulness"     value={avgFaith}  glowColor={metricToGlowColor(avgFaith)}  />
        <StatBlock label="Avg Answer Relevancy" value={avgRel}    glowColor={metricToGlowColor(avgRel)}    />
        <StatBlock label="Avg Context Recall"   value={avgRecall} glowColor={metricToGlowColor(avgRecall)} />
        <StatBlock label="Top Loss Bucket"      value={topBucket} isText glowColor="blue" />
      </div>

      {history.length === 0 ? (
        <div className="eval-empty">
          No eval data yet — run queries and results appear here automatically.
        </div>
      ) : (
        <>
          <div className="bucket-section">
            <div className="section-heading">Loss Distribution — {history.length} queries</div>
            <BucketChart counts={bucketCounts} />
          </div>

          <div className="eval-table-section">
            <div className="section-heading">Query History — most recent first</div>
            <table className="eval-tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Query</th>
                  <th>Faithfulness</th>
                  <th>Relevancy</th>
                  <th>Recall</th>
                  <th>Bucket</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={row.id} className={i % 2 === 1 ? 'row-dim' : ''}>
                    <td className="td-time">
                      {new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="td-query" title={row.query}>
                      {row.query.length > 45 ? row.query.slice(0, 45) + '…' : row.query}
                    </td>
                    <td className={metricClass(row.faithfulness)}>
                      {row.faithfulness?.toFixed(3) ?? '—'}
                    </td>
                    <td className={metricClass(row.answer_relevancy)}>
                      {row.answer_relevancy?.toFixed(3) ?? '—'}
                    </td>
                    <td className={metricClass(row.context_recall)}>
                      {row.context_recall?.toFixed(3) ?? '—'}
                    </td>
                    <td>
                      <span className={`bkt-badge ${bucketBadgeClass(row.loss_bucket)}`}>
                        {row.loss_bucket?.replace('_', ' ') ?? '—'}
                      </span>
                    </td>
                    <td className="td-lat">{row.latency_ms?.toLocaleString()}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
