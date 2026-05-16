import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from retrieval.hybrid import HybridRetriever


def _format_row(rank: int, result: dict) -> str:
    preview = result["chunk_text"][:200].replace("\n", " ")
    score = f"{result['rerank_score']:.4f}"
    bill = result["bill_number"][:12].ljust(12)
    title = (result["title"] or "")[:40].ljust(40)
    return f"  {rank:<4} {bill} {title} {score:<10} {preview}"


async def run_query(retriever: HybridRetriever, query: str) -> dict:
    results, latency = await retriever.retrieve(query, top_k=5)

    print(f"\nQuery: \"{query}\"")
    print("-" * 120)
    print(f"  {'Rank':<4} {'Bill':<12} {'Title':<40} {'Score':<10} {'Chunk Preview (200 chars)'}")
    print("-" * 120)

    for rank, r in enumerate(results, 1):
        print(_format_row(rank, r))

    print(
        f"\n  Latency -> BM25: {latency['bm25_ms']:.1f}ms | "
        f"pgvector: {latency['vector_ms']:.1f}ms | "
        f"RRF: {latency['rrf_ms']:.1f}ms | "
        f"Reranker: {latency['rerank_ms']:.1f}ms | "
        f"Total: {latency['total_ms']:.1f}ms"
    )

    return {"query": query, "top_result": results[0] if results else None, "latency": latency}


async def main() -> None:
    if len(sys.argv) > 1:
        queries = [" ".join(sys.argv[1:])]
    else:
        queries = [
            "affordable housing legislation new jersey",
            "environmental protection water quality bills",
            "education funding public schools",
        ]

    print("Initializing HybridRetriever...")
    retriever = HybridRetriever()

    all_latencies: list[dict] = []
    summaries: list[dict] = []

    for query in queries:
        result = await run_query(retriever, query)
        summaries.append(result)
        all_latencies.append(result["latency"])

    if len(queries) > 1:
        avg_bm25 = sum(l["bm25_ms"] for l in all_latencies) / len(all_latencies)
        avg_vec = sum(l["vector_ms"] for l in all_latencies) / len(all_latencies)
        avg_rrf = sum(l["rrf_ms"] for l in all_latencies) / len(all_latencies)
        avg_rerank = sum(l["rerank_ms"] for l in all_latencies) / len(all_latencies)
        avg_total = sum(l["total_ms"] for l in all_latencies) / len(all_latencies)

        print("\n" + "=" * 80)
        print("AVERAGE LATENCY BREAKDOWN")
        print("=" * 80)
        print(f"  BM25:       {avg_bm25:.1f}ms")
        print(f"  pgvector:   {avg_vec:.1f}ms")
        print(f"  RRF fusion: {avg_rrf:.1f}ms")
        print(f"  Reranker:   {avg_rerank:.1f}ms")
        print(f"  Total:      {avg_total:.1f}ms")

        print("\n" + "=" * 80)
        print("RETRIEVAL SUMMARY TABLE")
        print("=" * 80)
        print(f"  {'Query':<45} {'Top Bill':<14} {'Rerank Score':<14} {'Total Latency'}")
        print("-" * 80)
        for s in summaries:
            top = s["top_result"]
            if top:
                bill = top["bill_number"][:13]
                score = f"{top['rerank_score']:.4f}"
            else:
                bill = "N/A"
                score = "N/A"
            lat = f"{s['latency']['total_ms']:.0f}ms"
            q = s["query"][:44]
            print(f"  {q:<45} {bill:<14} {score:<14} {lat}")


if __name__ == "__main__":
    asyncio.run(main())
