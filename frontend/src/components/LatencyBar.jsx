export default function LatencyBar({ latency }) {
  if (!latency) return null

  return (
    <div className="latency-row">
      <span className="lat-item">BM25 <span>{Math.round(latency.bm25_ms)}ms</span></span>
      <span className="lat-item">Vector <span>{Math.round(latency.vector_ms)}ms</span></span>
      <span className="lat-item">Rerank <span>{Math.round(latency.rerank_ms)}ms</span></span>
      <span className="lat-item lat-total">Total <span>{Math.round(latency.total_ms)}ms</span></span>
    </div>
  )
}
