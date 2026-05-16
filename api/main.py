import asyncio
import json
import re
import sqlite3
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from retrieval.hybrid import HybridRetriever
from storage.db import get_chunk_count

load_dotenv()

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_retriever: HybridRetriever | None = None
_embedder = None  # SentenceTransformer, shared from retriever

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EVALS_DB = DATA_DIR / "evals.db"


# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------
def _init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(str(EVALS_DB))
    con.execute("""
        CREATE TABLE IF NOT EXISTS evals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT    NOT NULL,
            query         TEXT    NOT NULL,
            answer        TEXT    NOT NULL,
            faithfulness  REAL,
            answer_relevancy REAL,
            context_recall   REAL,
            loss_bucket   TEXT,
            latency_ms    INTEGER
        )
    """)
    con.commit()
    con.close()


def _store_eval(
    query: str,
    answer: str,
    faithfulness: float,
    answer_relevancy: float,
    context_recall: float,
    loss_bucket: str,
    latency_ms: int,
) -> None:
    con = sqlite3.connect(str(EVALS_DB))
    con.execute(
        "INSERT INTO evals (timestamp, query, answer, faithfulness, answer_relevancy, "
        "context_recall, loss_bucket, latency_ms) VALUES (?,?,?,?,?,?,?,?)",
        (
            datetime.now(timezone.utc).isoformat(),
            query, answer,
            faithfulness, answer_relevancy, context_recall,
            loss_bucket, latency_ms,
        ),
    )
    con.commit()
    con.close()


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _retriever, _embedder
    _init_db()
    print("Loading HybridRetriever at startup...")
    _retriever = await asyncio.to_thread(HybridRetriever)
    _embedder = _retriever.embedder
    print("HybridRetriever ready.")
    yield
    _retriever = None
    _embedder = None


app = FastAPI(title="CivicRAG API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class QueryRequest(BaseModel):
    query: str
    top_k: int = 8


class EvalRequest(BaseModel):
    query: str
    answer: str
    contexts: list[str]
    latency_ms: int = 0


# ---------------------------------------------------------------------------
# Query-mode system prompts
# ---------------------------------------------------------------------------
SYSTEM_PROMPTS = {
    "lookup": (
        "You are CivicRAG, a legislative AI assistant. "
        "Answer the specific question using only the provided bill context. "
        "Always cite bill numbers. Be precise and factual. Keep your answer concise."
    ),
    "summarize": (
        "You are CivicRAG, a legislative AI assistant. "
        "Provide a comprehensive synthesis of the provided bill context on this topic. "
        "Cite multiple bill numbers. Highlight key themes and policy differences."
    ),
    "compare": (
        "You are CivicRAG, a legislative AI assistant. "
        "Provide a structured side-by-side comparison of the bills in the provided context. "
        "Use clear headings or bullet points. Always cite bill numbers."
    ),
}


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
async def _classify_query(groq: AsyncGroq, query: str) -> str:
    resp = await groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "Classify the legislative query into exactly one word: "
                    "lookup, summarize, or compare. "
                    "lookup = specific bill or fact. "
                    "summarize = broad topic. "
                    "compare = two bills or policies. "
                    "Reply with only the single word."
                ),
            },
            {"role": "user", "content": query},
        ],
        max_tokens=5,
        temperature=0.0,
    )
    raw = resp.choices[0].message.content.strip().lower()
    return raw if raw in ("lookup", "summarize", "compare") else "summarize"


def _build_context(results: list[dict]) -> str:
    parts = []
    for i, r in enumerate(results, 1):
        parts.append(f"[{i}] Bill {r['bill_number']} — {r.get('title', '')}\n{r['chunk_text']}")
    return "\n\n---\n\n".join(parts)


def _sse(event_type: str, data) -> str:
    return f"data: {json.dumps({'type': event_type, 'data': data})}\n\n"


# ---------------------------------------------------------------------------
# RAGAS-style metric computations
# ---------------------------------------------------------------------------
def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


async def _compute_faithfulness(groq: AsyncGroq, answer: str, contexts: list[str]) -> float:
    """Fraction of answer sentences directly supported by retrieved contexts."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", answer) if len(s.strip()) > 15]
    if not sentences:
        return 1.0
    context_text = "\n\n".join(contexts[:6])[:3000]
    numbered = "\n".join(f"{i+1}. {s}" for i, s in enumerate(sentences[:12]))
    resp = await groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "For each numbered sentence, reply YES if directly supported by the contexts, "
                    "or NO if not. Reply ONLY as a comma-separated list: YES, NO, YES, ... "
                    "One answer per sentence, in order. No other text."
                ),
            },
            {"role": "user", "content": f"Contexts:\n{context_text}\n\nSentences:\n{numbered}"},
        ],
        max_tokens=80,
        temperature=0.0,
    )
    raw = resp.choices[0].message.content.strip()
    parts = [p.strip().upper() for p in re.split(r"[,\n]+", raw)]
    supported = sum(1 for p in parts if "YES" in p)
    return round(supported / len(sentences), 4)


async def _compute_answer_relevancy(groq: AsyncGroq, query: str, answer: str) -> float:
    """Avg cosine similarity between generated back-questions and original query."""
    if _embedder is None:
        return 0.5
    resp = await groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "Generate exactly 3 questions that this answer is responding to. "
                    "Output only the questions, numbered 1. 2. 3., one per line, nothing else."
                ),
            },
            {"role": "user", "content": f"Answer: {answer[:600]}"},
        ],
        max_tokens=150,
        temperature=0.3,
    )
    raw = resp.choices[0].message.content.strip()
    questions = [re.sub(r"^[0-9]+[.)]\s*", "", ln).strip() for ln in raw.split("\n") if ln.strip()]
    if not questions:
        return 0.5
    all_texts = [query] + questions[:3]
    embeddings = await asyncio.to_thread(_embedder.encode, all_texts, convert_to_numpy=True)
    sims = [_cosine_sim(embeddings[0], embeddings[i]) for i in range(1, len(embeddings))]
    return round(float(np.mean(sims)), 4)


async def _compute_context_recall(groq: AsyncGroq, answer: str, contexts: list[str]) -> float:
    """Fraction of answer claims attributable to retrieved contexts."""
    context_text = "\n\n".join(contexts[:6])[:3000]
    resp = await groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "Count distinct factual claims in the answer, then count how many "
                    "can be found in or inferred from the contexts. "
                    "Reply ONLY as two integers separated by a slash: attributable/total. No other text."
                ),
            },
            {
                "role": "user",
                "content": f"Contexts:\n{context_text}\n\nAnswer: {answer[:800]}",
            },
        ],
        max_tokens=15,
        temperature=0.0,
    )
    raw = resp.choices[0].message.content.strip()
    m = re.search(r"(\d+)\s*/\s*(\d+)", raw)
    if m:
        attr, total = int(m.group(1)), int(m.group(2))
        return round(min(attr / max(total, 1), 1.0), 4)
    return 0.5


def _loss_bucket(faithfulness: float, context_recall: float, latency_ms: int) -> str:
    if faithfulness < 0.5:
        return "hallucination"
    if context_recall < 0.5:
        return "retrieval_miss"
    if latency_ms > 5000:
        return "latency"
    return "ok"


async def _run_eval_and_store(
    query: str, answer: str, contexts: list[str], total_ms: int
) -> None:
    try:
        groq = AsyncGroq()
        faithfulness, context_recall, answer_relevancy = await asyncio.gather(
            _compute_faithfulness(groq, answer, contexts),
            _compute_context_recall(groq, answer, contexts),
            _compute_answer_relevancy(groq, query, answer),
        )
        bucket = _loss_bucket(faithfulness, context_recall, total_ms)
        _store_eval(query, answer, faithfulness, answer_relevancy, context_recall, bucket, total_ms)
        print(
            f"[eval] faith={faithfulness:.3f} rel={answer_relevancy:.3f} "
            f"recall={context_recall:.3f} bucket={bucket} latency={total_ms}ms"
        )
    except Exception as exc:
        print(f"[eval] error: {exc}")


# ---------------------------------------------------------------------------
# SSE stream generator
# ---------------------------------------------------------------------------
async def _stream_query(request: QueryRequest) -> AsyncGenerator[str, None]:
    t_start = time.perf_counter()
    full_answer = ""
    contexts: list[str] = []

    try:
        groq = AsyncGroq()

        mode = await _classify_query(groq, request.query)
        yield _sse("mode", mode)

        top_k = 5 if mode == "lookup" else 10
        system_prompt = SYSTEM_PROMPTS[mode]

        results, latency = await _retriever.retrieve(request.query, top_k=top_k)
        contexts = [r["chunk_text"] for r in results]

        sources = [
            {
                "bill_number": r["bill_number"],
                "title": r.get("title", ""),
                "rerank_score": round(r.get("rerank_score", 0.0), 4),
                "chunk_preview": r["chunk_text"][:220],
                "source_url": r.get("source_url", ""),
            }
            for r in results
        ]
        yield _sse("sources", {"sources": sources, "latency": latency})

        context_str = _build_context(results)
        stream = await groq.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Legislative context:\n\n{context_str}\n\nQuestion: {request.query}",
                },
            ],
            stream=True,
            max_tokens=1024,
            temperature=0.2,
        )

        async for chunk in stream:
            token = chunk.choices[0].delta.content or ""
            if token:
                full_answer += token
                yield _sse("token", token)

        total_ms = int((time.perf_counter() - t_start) * 1000)
        yield _sse("done", "")

        # Fire-and-forget eval — does not block the response
        if full_answer and contexts:
            asyncio.ensure_future(
                _run_eval_and_store(request.query, full_answer, contexts, total_ms)
            )

    except Exception as exc:
        yield _sse("error", str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "chunks_indexed": get_chunk_count()}


@app.post("/query")
async def query_endpoint(request: QueryRequest):
    if _retriever is None:
        raise HTTPException(status_code=503, detail="Retriever not initialized")
    return StreamingResponse(
        _stream_query(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/eval")
async def eval_endpoint(request: EvalRequest):
    groq = AsyncGroq()
    faithfulness, context_recall, answer_relevancy = await asyncio.gather(
        _compute_faithfulness(groq, request.answer, request.contexts),
        _compute_context_recall(groq, request.answer, request.contexts),
        _compute_answer_relevancy(groq, request.query, request.answer),
    )
    bucket = _loss_bucket(faithfulness, context_recall, request.latency_ms)
    _store_eval(
        request.query, request.answer,
        faithfulness, answer_relevancy, context_recall,
        bucket, request.latency_ms,
    )
    return {
        "faithfulness": faithfulness,
        "answer_relevancy": answer_relevancy,
        "context_recall": context_recall,
        "loss_bucket": bucket,
        "latency_ms": request.latency_ms,
    }


@app.get("/eval/history")
def eval_history():
    con = sqlite3.connect(str(EVALS_DB))
    rows = con.execute(
        "SELECT id, timestamp, query, faithfulness, answer_relevancy, "
        "context_recall, loss_bucket, latency_ms "
        "FROM evals ORDER BY timestamp DESC LIMIT 20"
    ).fetchall()
    con.close()
    return [
        {
            "id": r[0],
            "timestamp": r[1],
            "query": r[2],
            "faithfulness": r[3],
            "answer_relevancy": r[4],
            "context_recall": r[5],
            "loss_bucket": r[6],
            "latency_ms": r[7],
        }
        for r in rows
    ]
