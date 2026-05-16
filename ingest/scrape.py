import asyncio
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx
import tiktoken
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from storage.db import check_bill_exists, get_collection, upsert_chunk

# govinfo.gov bulk XML — 118th Congress (2023-2024), Session 1
# No API key required for direct file access
HR_BASE = "https://www.govinfo.gov/bulkdata/BILLS/118/1/hr"
S_BASE = "https://www.govinfo.gov/bulkdata/BILLS/118/1/s"
DC_NS = "http://purl.org/dc/elements/1.1/"

CHUNK_TOKENS = 512
OVERLAP_TOKENS = 64
MIN_CHUNK_TOKENS = 100
TOKENIZER = tiktoken.get_encoding("cl100k_base")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
}


def _clean_text(raw: str) -> str:
    raw = re.sub(r"\s+", " ", raw)
    # Remove non-printable / non-ASCII replacement characters
    raw = re.sub(r"[^\x20-\x7E\n]", " ", raw)
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def _extract_xml_text(xml_bytes: bytes) -> tuple[str, str, str]:
    """Returns (title, date_introduced, body_text)."""
    xml_text = xml_bytes.decode("utf-8", errors="replace")
    # Strip DOCTYPE and XSL PI — ElementTree cannot handle them
    xml_text = re.sub(r"<!DOCTYPE[^>]*>", "", xml_text, count=1)
    xml_text = re.sub(r"<\?xml-stylesheet[^?]*\?>", "", xml_text)

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return "", "", ""

    title_el = root.find(f".//{{{DC_NS}}}title")
    date_el = root.find(f".//{{{DC_NS}}}date")
    title = title_el.text.strip() if title_el is not None and title_el.text else ""
    date = date_el.text.strip() if date_el is not None and date_el.text else ""

    legis_body = root.find(".//legis-body")
    if legis_body is None:
        return title, date, ""

    parts: list[str] = []
    for elem in legis_body.iter():
        if elem.text and elem.text.strip():
            parts.append(elem.text.strip())
        if elem.tail and elem.tail.strip():
            parts.append(elem.tail.strip())

    return title, date, _clean_text(" ".join(parts))


def _chunk_text(text: str) -> list[str]:
    tokens = TOKENIZER.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + CHUNK_TOKENS, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_str = TOKENIZER.decode(chunk_tokens)
        if len(chunk_tokens) >= MIN_CHUNK_TOKENS:
            chunks.append(chunk_str)
        if end == len(tokens):
            break
        start += CHUNK_TOKENS - OVERLAP_TOKENS
    return chunks


async def _fetch_xml(
    client: httpx.AsyncClient,
    url: str,
    max_retries: int = 2,
    timeout: float = 45.0,
) -> bytes | None:
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, timeout=timeout, follow_redirects=True)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "").lower()
            if "html" in ct:
                return None
            return resp.content
        except (httpx.HTTPError, httpx.TimeoutException):
            if attempt == max_retries - 1:
                return None
            await asyncio.sleep(1.5)
    return None


async def _process_bill(
    client: httpx.AsyncClient,
    bill_number: str,
    xml_url: str,
    collection,
    pbar: tqdm,
) -> int:
    if check_bill_exists(collection, bill_number):
        pbar.update(1)
        return 0

    xml_bytes = await _fetch_xml(client, xml_url)
    if xml_bytes is None:
        pbar.update(1)
        return 0

    title, date_introduced, body_text = _extract_xml_text(xml_bytes)
    if len(body_text) < 200:
        pbar.update(1)
        return 0

    chunks = _chunk_text(body_text)
    if not chunks:
        pbar.update(1)
        return 0

    for idx, chunk_str in enumerate(chunks):
        upsert_chunk(
            collection=collection,
            bill_number=bill_number,
            title=title,
            date_introduced=date_introduced,
            source_url=xml_url,
            chunk_index=idx,
            chunk_text=chunk_str,
            embedding=None,
            metadata={"total_chunks": len(chunks)},
        )

    pbar.update(1)
    return len(chunks)


async def main() -> None:
    collection = get_collection()

    candidates: list[tuple[str, str]] = []
    for num in range(1, 501):
        bill_number = f"HR{num}"
        xml_url = f"{HR_BASE}/BILLS-118hr{num}ih.xml"
        candidates.append((bill_number, xml_url))
    for num in range(1, 301):
        bill_number = f"S{num}"
        xml_url = f"{S_BASE}/BILLS-118s{num}is.xml"
        candidates.append((bill_number, xml_url))

    print(f"Queuing {len(candidates)} XML candidates (HR1-HR500, S1-S300, 118th Congress)...")

    total_chunks = 0
    downloaded = 0

    async with httpx.AsyncClient(headers=HEADERS) as client:
        with tqdm(total=len(candidates), desc="Downloading bills", unit="bill") as pbar:
            semaphore = asyncio.Semaphore(6)

            async def bounded(bill_number: str, xml_url: str) -> int:
                async with semaphore:
                    return await _process_bill(client, bill_number, xml_url, collection, pbar)

            results = await asyncio.gather(
                *[bounded(bn, url) for bn, url in candidates],
                return_exceptions=True,
            )

    for r in results:
        if isinstance(r, int) and r > 0:
            total_chunks += r
            downloaded += 1

    print(f"\nIngestion complete: {downloaded} bills downloaded, {total_chunks} chunks stored")


if __name__ == "__main__":
    asyncio.run(main())
