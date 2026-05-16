import json
import pickle
import sys
import time
from pathlib import Path

import numpy as np
from sentence_transformers import CrossEncoder, SentenceTransformer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from storage.db import get_collection

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BM25_INDEX_PATH = DATA_DIR / "bm25_index.pkl"
CHUNKS_METADATA_PATH = DATA_DIR / "chunks_metadata.json"

EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
RERANK_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
BM25_CANDIDATES = 25
VECTOR_CANDIDATES = 25
RRF_K = 60


class HybridRetriever:
    def __init__(self) -> None:
        print(f"Loading embedder: {EMBED_MODEL_NAME}")
        self.embedder = SentenceTransformer(EMBED_MODEL_NAME)

        print(f"Loading cross-encoder: {RERANK_MODEL_NAME}")
        self.reranker = CrossEncoder(RERANK_MODEL_NAME)

        print(f"Loading BM25 index from {BM25_INDEX_PATH}")
        with open(BM25_INDEX_PATH, "rb") as f:
            self.bm25 = pickle.load(f)

        print(f"Loading chunk metadata from {CHUNKS_METADATA_PATH}")
        with open(CHUNKS_METADATA_PATH, "r", encoding="utf-8") as f:
            self.chunks_metadata: list[dict] = json.load(f)

        print("Connecting to ChromaDB collection...")
        self.collection = get_collection()

    def _bm25_retrieve(self, query: str) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        tokens = query.lower().split()
        scores = self.bm25.get_scores(tokens)
        top_indices = np.argsort(scores)[::-1][:BM25_CANDIDATES]
        results = []
        for rank, idx in enumerate(top_indices):
            if scores[idx] <= 0:
                continue
            meta = self.chunks_metadata[idx]
            results.append({
                "bm25_index": int(idx),
                "db_id": meta["id"],
                "bill_number": meta["bill_number"],
                "title": meta["title"],
                "source_url": meta["source_url"],
                "chunk_text": meta["chunk_text"],
                "bm25_score": float(scores[idx]),
                "bm25_rank": rank,
            })
        return results, (time.perf_counter() - t0) * 1000

    def _vector_retrieve(self, query: str) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        embedding = self.embedder.encode(query, convert_to_numpy=True).tolist()
        raw = self.collection.query(
            query_embeddings=[embedding],
            n_results=VECTOR_CANDIDATES,
            include=["metadatas", "distances", "documents"],
        )
        ids = raw["ids"][0]
        distances = raw["distances"][0]
        metadatas = raw["metadatas"][0]
        documents = raw["documents"][0]
        results = []
        for rank, (chunk_id, dist, meta, doc) in enumerate(
            zip(ids, distances, metadatas, documents)
        ):
            results.append({
                "db_id": chunk_id,
                "bill_number": meta.get("bill_number", ""),
                "title": meta.get("title", ""),
                "source_url": meta.get("source_url", ""),
                "chunk_text": doc,
                "vector_score": float(1.0 - dist),
                "vector_rank": rank,
            })
        return results, (time.perf_counter() - t0) * 1000

    def _rrf_fuse(
        self,
        bm25_results: list[dict],
        vector_results: list[dict],
    ) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        merged: dict[str, dict] = {}

        for item in bm25_results:
            did = item["db_id"]
            rrf = 1.0 / (RRF_K + item["bm25_rank"] + 1)
            if did not in merged:
                merged[did] = {
                    "db_id": did,
                    "bill_number": item["bill_number"],
                    "title": item["title"],
                    "source_url": item["source_url"],
                    "chunk_text": item["chunk_text"],
                    "bm25_score": item["bm25_score"],
                    "vector_score": 0.0,
                    "rrf_score": 0.0,
                }
            merged[did]["rrf_score"] += rrf

        for item in vector_results:
            did = item["db_id"]
            rrf = 1.0 / (RRF_K + item["vector_rank"] + 1)
            if did not in merged:
                merged[did] = {
                    "db_id": did,
                    "bill_number": item["bill_number"],
                    "title": item["title"],
                    "source_url": item["source_url"],
                    "chunk_text": item["chunk_text"],
                    "bm25_score": 0.0,
                    "vector_score": item["vector_score"],
                    "rrf_score": 0.0,
                }
            else:
                merged[did]["vector_score"] = item["vector_score"]
            merged[did]["rrf_score"] += rrf

        fused = sorted(merged.values(), key=lambda x: x["rrf_score"], reverse=True)[
            :BM25_CANDIDATES
        ]
        return fused, (time.perf_counter() - t0) * 1000

    def _rerank(
        self, query: str, candidates: list[dict], top_k: int
    ) -> tuple[list[dict], float]:
        t0 = time.perf_counter()
        pairs = [(query, c["chunk_text"]) for c in candidates]
        scores = self.reranker.predict(pairs)
        for c, score in zip(candidates, scores):
            c["rerank_score"] = float(score)
        ranked = sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)[
            :top_k
        ]
        return ranked, (time.perf_counter() - t0) * 1000

    async def retrieve(
        self, query: str, top_k: int = 8
    ) -> tuple[list[dict], dict[str, float]]:
        bm25_results, bm25_ms = self._bm25_retrieve(query)
        vector_results, vector_ms = self._vector_retrieve(query)
        fused, rrf_ms = self._rrf_fuse(bm25_results, vector_results)
        ranked, rerank_ms = self._rerank(query, fused, top_k)
        latency = {
            "bm25_ms": bm25_ms,
            "vector_ms": vector_ms,
            "rrf_ms": rrf_ms,
            "rerank_ms": rerank_ms,
            "total_ms": bm25_ms + vector_ms + rrf_ms + rerank_ms,
        }
        return ranked, latency
