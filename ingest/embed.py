import json
import pickle
import sys
from pathlib import Path

from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from storage.db import (
    get_all_chunks,
    get_chunks_without_embeddings,
    get_collection,
    update_embedding,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BM25_INDEX_PATH = DATA_DIR / "bm25_index.pkl"
CHUNKS_METADATA_PATH = DATA_DIR / "chunks_metadata.json"
BATCH_SIZE = 64
MODEL_NAME = "all-MiniLM-L6-v2"


def embed_missing_chunks(collection, model: SentenceTransformer) -> int:
    pending = get_chunks_without_embeddings(collection)
    if not pending:
        print("No chunks missing embeddings.")
        return 0

    print(f"Embedding {len(pending)} chunks in batches of {BATCH_SIZE}...")
    total = 0

    for start in tqdm(range(0, len(pending), BATCH_SIZE), desc="Embedding batches"):
        batch = pending[start : start + BATCH_SIZE]
        texts = [row["chunk_text"] for row in batch]
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)

        for row, emb in zip(batch, embeddings):
            update_embedding(collection, row["id"], emb.tolist())

        total += len(batch)

    return total


def build_bm25_index(collection) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    all_chunks = get_all_chunks(collection)
    if not all_chunks:
        print("No chunks in collection; skipping BM25 build.")
        return

    print(f"Building BM25 index over {len(all_chunks)} chunks...")
    tokenized_corpus: list[list[str]] = []
    metadata_list: list[dict] = []

    for row in tqdm(all_chunks, desc="Tokenizing for BM25"):
        tokenized_corpus.append(row["chunk_text"].lower().split())
        metadata_list.append({
            "id": row["id"],
            "bill_number": row["bill_number"],
            "title": row.get("title", ""),
            "date_introduced": row.get("date_introduced", ""),
            "source_url": row.get("source_url", ""),
            "chunk_index": row.get("chunk_index", 0),
            "chunk_text": row["chunk_text"],
        })

    bm25 = BM25Okapi(tokenized_corpus)

    with open(BM25_INDEX_PATH, "wb") as f:
        pickle.dump(bm25, f)

    with open(CHUNKS_METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata_list, f, ensure_ascii=False)

    print(f"BM25 index -> {BM25_INDEX_PATH}")
    print(f"Chunk metadata -> {CHUNKS_METADATA_PATH}")


def main() -> None:
    print(f"Loading SentenceTransformer: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    collection = get_collection()

    embedded = embed_missing_chunks(collection, model)
    print(f"Embeddings generated: {embedded}")

    build_bm25_index(collection)
    print("Done.")


if __name__ == "__main__":
    main()
