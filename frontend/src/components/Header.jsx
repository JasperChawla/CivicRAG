import { motion } from 'framer-motion'

const words = ['Ask', 'Congress.']

export default function Header() {
  return (
    <div className="hero">
      <motion.h1
        className="hero-heading"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        {words.map((word, i) => (
          <motion.span
            key={i}
            className="hero-word"
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
            }}
          >
            {word}
          </motion.span>
        ))}
      </motion.h1>
      <motion.span
        className="hero-sub"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        118th Congress · 538 Bills · Hybrid RAG
      </motion.span>
    </div>
  )
}
