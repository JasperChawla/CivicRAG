import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

function bucketClass(bucket) {
  switch (bucket) {
    case 'ok':             return 'bkt-ok'
    case 'hallucination':  return 'bkt-hall'
    case 'retrieval_miss': return 'bkt-ret'
    case 'latency':        return 'bkt-lat'
    default:               return 'bkt-na'
  }
}

export default function QueryHistoryDrawer({ onQuerySelect }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState([])

  async function fetchHistory() {
    try {
      const res = await fetch(`${API_BASE}/eval/history`)
      if (res.ok) setHistory(await res.json())
    } catch {}
  }

  useEffect(() => {
    fetchHistory()
    const id = setInterval(fetchHistory, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (open) fetchHistory()
  }, [open])

  function handleRowClick(row) {
    setOpen(false)
    onQuerySelect(row.query)
  }

  const recent = history.slice(0, 10)

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="drawer-panel"
              initial={{ y: 300 }}
              animate={{ y: 0 }}
              exit={{ y: 300 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="drawer-head">
                <span className="drawer-head-label">Recent Queries</span>
                <button className="drawer-close" onClick={() => setOpen(false)}>✕</button>
              </div>
              <div className="drawer-list">
                {recent.length === 0 ? (
                  <div className="drawer-empty">No queries yet — run a search to see history.</div>
                ) : (
                  recent.map(row => (
                    <div key={row.id} className="drawer-row" onClick={() => handleRowClick(row)}>
                      <span className="drawer-row-time">
                        {new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="drawer-row-query">{row.query}</span>
                      {row.loss_bucket && (
                        <span className={`drawer-row-bkt ${bucketClass(row.loss_bucket)}`}>
                          {row.loss_bucket.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="drawer-trigger" onClick={() => setOpen(o => !o)}>
        <span className="drawer-trigger-label">Recent Queries</span>
        <span className="drawer-count">{history.length}</span>
        <span className={`drawer-chevron${open ? ' open' : ''}`}>▲</span>
      </div>
    </>
  )
}
