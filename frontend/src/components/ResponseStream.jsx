import { motion } from 'framer-motion'

export default function ResponseStream({ text, isStreaming }) {
  if (!text && !isStreaming) return null

  return (
    <motion.div
      className="response-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="response-label">Response</div>
      <div className="response-text">
        {text}
        {isStreaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
    </motion.div>
  )
}
