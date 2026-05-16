from pathlib import Path

import chromadb

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CHROMA_PATH = DATA_DIR / "chroma_db"
COLLECTION_NAME = "bill_chunks"
EMBEDDING_DIM = 384

_collection = None


def get_collection():
    global _collection
    if _collection is None:
        DATA_DIR.mkdir(exist_ok=True)
        client = chromadb.PersistentClient(path=str(CHROMA_PATH))
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def get_chunk_count() -> int:
    return get_collection().count()


def _chunk_id(bill_number: str, chunk_index: int) -> str:
    return f"{bill_number}__{chunk_index}"


def upsert_chunk(
    collection,
    bill_number: str,
    title: str,
    date_introduced: str,
    source_url: str,
    chunk_index: int,
    chunk_text: str,
    embedding: list[float] | None,
    metadata: dict,
) -> None:
    chunk_id = _chunk_id(bill_number, chunk_index)
    emb = embedding if embedding is not None else [0.0] * EMBEDDING_DIM
    meta = {
        "bill_number": bill_number,
        "title": title or "",
        "date_introduced": date_introduced or "",
        "source_url": source_url or "",
        "chunk_index": chunk_index,
        "total_chunks": int(metadata.get("total_chunks", 0)),
        "embedded": 1 if embedding is not None else 0,
    }
    collection.upsert(
        ids=[chunk_id],
        embeddings=[emb],
        documents=[chunk_text],
        metadatas=[meta],
    )


def check_bill_exists(collection, bill_number: str) -> bool:
    results = collection.get(
        where={"bill_number": {"$eq": bill_number}},
        limit=1,
        include=[],
    )
    return len(results["ids"]) > 0


def get_all_chunks(collection) -> list[dict]:
    results = collection.get(include=["metadatas", "documents"])
    chunks = []
    for chunk_id, doc, meta in zip(
        results["ids"], results["documents"], results["metadatas"]
    ):
        chunks.append({"id": chunk_id, "chunk_text": doc, **meta})
    return chunks


def get_chunks_without_embeddings(collection) -> list[dict]:
    results = collection.get(
        where={"embedded": {"$eq": 0}},
        include=["metadatas", "documents"],
    )
    chunks = []
    for chunk_id, doc, meta in zip(
        results["ids"], results["documents"], results["metadatas"]
    ):
        chunks.append({"id": chunk_id, "chunk_text": doc, **meta})
    return chunks


def update_embedding(collection, chunk_id: str, embedding: list[float]) -> None:
    result = collection.get(ids=[chunk_id], include=["metadatas", "documents"])
    if not result["ids"]:
        return
    meta = dict(result["metadatas"][0])
    meta["embedded"] = 1
    collection.upsert(
        ids=[chunk_id],
        embeddings=[embedding],
        documents=[result["documents"][0]],
        metadatas=[meta],
    )
