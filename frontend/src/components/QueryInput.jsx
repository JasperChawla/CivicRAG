import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function QueryInput({ query, setQuery, onSubmit, isStreaming, mode }) {
  const ref = useRef(null)

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="query-area">
      <div className="query-input-wrap">
        <textarea
          ref={ref}
          className="query-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What legislation do you want to understand?"
          rows={3}
          disabled={isStreaming}
        />
        <button
          className="search-btn"
          onClick={onSubmit}
          disabled={isStreaming || !query.trim()}
        >
          {isStreaming ? 'Searching…' : 'Search →'}
        </button>
      </div>

      <div className="query-meta">
        <AnimatePresence>
          {mode && (
            <motion.span
              className="mode-label"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {mode}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="key-hint">Ctrl+Enter to submit</span>
      </div>
    </div>
  )
}
