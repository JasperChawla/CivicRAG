"""Run 5 test queries against the live backend and stream results."""
import httpx
import json

QUERIES = [
    "What bills address affordable housing?",
    "Summarize environmental protection legislation",
    "What education funding bills were introduced?",
    "Compare housing voucher programs in different bills",
    "What are the latest defense authorization provisions?",
]

def run_query(query: str) -> None:
    print(f"\n{'='*60}")
    print(f"QUERY: {query}")
    print('='*60)

    with httpx.Client(timeout=120) as c:
        with c.stream(
            "POST",
            "http://localhost:8000/query",
            json={"query": query, "top_k": 8},
        ) as resp:
            resp.raise_for_status()
            buffer = ""
            mode_shown = False
            sources_shown = False
            token_count = 0

            for chunk in resp.iter_bytes():
                buffer += chunk.decode("utf-8", errors="replace")
                events = buffer.split("\n\n")
                buffer = events.pop()

                for event_str in events:
                    if not event_str.strip():
                        continue
                    for line in event_str.split("\n"):
                        if not line.startswith("data: "):
                            continue
                        try:
                            obj = json.loads(line[6:])
                            t = obj["type"]
                            d = obj["data"]
                            if t == "mode" and not mode_shown:
                                print(f"  Mode: {d.upper()}")
                                mode_shown = True
                            elif t == "sources" and not sources_shown:
                                print(f"  Sources ({len(d['sources'])}):")
                                for s in d["sources"]:
                                    score = s["rerank_score"]
                                    sign = "+" if score >= 0 else ""
                                    print(f"    {s['bill_number']:8}  score={sign}{score:.4f}  {s['title'][:45]}")
                                lat = d["latency"]
                                print(f"  Retrieval latency: {lat['total_ms']:.0f}ms")
                                sources_shown = True
                            elif t == "token":
                                token_count += 1
                            elif t == "done":
                                print(f"  LLM tokens streamed: {token_count}")
                                print("  DONE")
                        except Exception:
                            pass

if __name__ == "__main__":
    for q in QUERIES:
        run_query(q)
    print(f"\n{'='*60}")
    print("All 5 queries complete. Eval auto-triggers are running in background.")
    print("Wait ~30s then check: GET http://localhost:8000/eval/history")
