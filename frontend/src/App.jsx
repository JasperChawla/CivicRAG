import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SmokeBackground from './components/SmokeBackground'
import GooeyText from './components/GooeyText'
import QueryInput from './components/QueryInput'
import SourceCards from './components/SourceCards'
import ResponseStream from './components/ResponseStream'
import LatencyBar from './components/LatencyBar'
import EvalDashboard from './components/EvalDashboard'
import QueryHistoryDrawer from './components/QueryHistoryDrawer'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export default function App() {
  const [activeTab, setActiveTab] = useState('query')

  const [query, setQuery]           = useState('')
  const [mode, setMode]             = useState(null)
  const [sources, setSources]       = useState([])
  const [responseText, setResponse] = useState('')
  const [isStreaming, setStreaming]  = useState(false)
  const [latency, setLatency]       = useState(null)
  const [error, setError]           = useState(null)

  async function runQuery(q) {
    const text = (q ?? query).trim()
    if (!text || isStreaming) return

    setQuery(text)
    setStreaming(true)
    setMode(null)
    setSources([])
    setResponse('')
    setLatency(null)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, top_k: 8 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventStr of events) {
          if (!eventStr.trim()) continue
          for (const line of eventStr.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const { type, data } = JSON.parse(line.slice(6))
              if      (type === 'mode')    setMode(data)
              else if (type === 'sources') { setSources(data.sources); setLatency(data.latency) }
              else if (type === 'token')   setResponse(prev => prev + data)
              else if (type === 'done')    setStreaming(false)
              else if (type === 'error')   { setError(data); setStreaming(false) }
            } catch {}
          }
        }
      }
    } catch (e) {
      setError(e.message)
      setStreaming(false)
    }
  }

  function handleSubmit() { runQuery(query) }

  function handleQuerySelect(q) {
    setActiveTab('query')
    runQuery(q)
  }

  return (
    <>
      {/* ── Persistent fullscreen smoke background ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: 0.85 }}>
        <SmokeBackground smokeColor="#ffffff" />
      </div>

      {/* ── Dark overlay to dim smoke so text pops ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

      {/* ── All content above smoke ── */}
      <div style={{ position: 'relative', zIndex: 10, minHeight: '100vh' }}>

        {/* Fixed nav */}
        <nav className="nav">
          <div className="nav-brand">
            <span className="nav-wordmark">CivicRAG</span>
            <span className="nav-tagline">Legislative Intelligence</span>
          </div>
          <div className="nav-links">
            <button
              className={`nav-link${activeTab === 'query' ? ' active' : ''}`}
              onClick={() => setActiveTab('query')}
            >
              Query
            </button>
            <button
              className={`nav-link${activeTab === 'eval' ? ' active' : ''}`}
              onClick={() => setActiveTab('eval')}
            >
              Eval Dashboard
            </button>
          </div>
        </nav>

        {/* Page body */}
        <div className="page">
          <AnimatePresence mode="wait">
            {activeTab === 'query' ? (
              <motion.div
                key="query"
                className="query-tab"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Hero — two-line heading + gooey morphing word */}
                <section className="hero">
                  <div className="hero-content">
                    <motion.span
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        display:    'block',
                        textAlign:  'center',
                        fontFamily: "'Georgia', 'Times New Roman', serif",
                        fontSize:   'clamp(64px, 10vw, 140px)',
                        fontWeight: 800,
                        color:      '#ffffff',
                        lineHeight: 1,
                        userSelect: 'none',
                        marginBottom: 8,
                      }}
                    >
                      ASK
                    </motion.span>
                    <GooeyText />
                    <motion.p
                      className="hero-sub"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1.5, duration: 0.8 }}
                    >
                      118th Congress · 538 Bills · Hybrid RAG
                    </motion.p>
                  </div>
                </section>

                {/* Query content */}
                <div className="query-content">
                  <QueryInput
                    query={query}
                    setQuery={setQuery}
                    onSubmit={handleSubmit}
                    isStreaming={isStreaming}
                    mode={mode}
                  />
                  {error && <div className="error-msg">Error: {error}</div>}
                  {sources.length > 0 && <SourceCards sources={sources} />}
                  {(responseText || isStreaming) && (
                    <ResponseStream text={responseText} isStreaming={isStreaming} />
                  )}
                  {latency && !isStreaming && <LatencyBar latency={latency} />}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="eval"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <EvalDashboard />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <QueryHistoryDrawer onQuerySelect={handleQuerySelect} />
      </div>
    </>
  )
}
