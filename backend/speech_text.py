import re
from dataclasses import dataclass
from typing import List, Tuple

HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*")
BLOCKQUOTE_RE = re.compile(r"^\s*>\s?")
UNORDERED_LIST_RE = re.compile(r"^\s*[-*+•]\s+")
ORDERED_LIST_RE = re.compile(r"^\s*\d+[.)]\s+")
HORIZONTAL_RULE_RE = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
LINK_RE = re.compile(r"!?\[([^\]]+)\]\([^)]+\)")
INLINE_CODE_RE = re.compile(r"`{1,3}([^`]+?)`{1,3}")
STANDALONE_MARKERS_RE = re.compile(r"(?:^|\s)([#-]{2,})(?=\s|$)")
TRAILING_EDGE_RE = re.compile(r"^[^\w]+|[^\w]+$")


@dataclass(frozen=True)
class EstimatedWordTiming:
    word: str
    start: float
    end: float
    index: int


def normalize_tts_text(text: str) -> str:
    if not text:
        return ""

    blocks: List[str] = []
    paragraph: List[str] = []
    in_fence = False

    for raw_line in text.splitlines():
        stripped = raw_line.strip()

        if stripped.startswith("```"):
            in_fence = not in_fence
            _flush_paragraph(blocks, paragraph)
            continue

        if not stripped:
            _flush_paragraph(blocks, paragraph)
            continue

        if HORIZONTAL_RULE_RE.match(stripped):
            _flush_paragraph(blocks, paragraph)
            continue

        cleaned, is_list_like = _clean_line(stripped, in_fence=in_fence)
        if not cleaned:
            continue
        if is_list_like and not re.search(r"[.!?;:]$", cleaned):
            cleaned = f"{cleaned}."
        paragraph.append(cleaned)

    _flush_paragraph(blocks, paragraph)
    return "\n\n".join(blocks).strip()


def estimate_word_timings(text: str) -> Tuple[List[EstimatedWordTiming], float]:
    tokens = _tokenize(text)
    if not tokens:
        return [], 0.0

    cursor = 0.0
    timings: List[EstimatedWordTiming] = []
    for index, token in enumerate(tokens):
        duration = _token_duration(token)
        timings.append(
            EstimatedWordTiming(
                word=token,
                start=round(cursor, 3),
                end=round(cursor + duration, 3),
                index=index,
            )
        )
        cursor += duration

    return timings, round(cursor, 3)


def _flush_paragraph(blocks: List[str], paragraph: List[str]) -> None:
    if paragraph:
        blocks.append(" ".join(paragraph).strip())
        paragraph.clear()


def _clean_line(line: str, *, in_fence: bool) -> tuple[str, bool]:
    is_list_like = False
    cleaned = line

    if not in_fence:
        cleaned = BLOCKQUOTE_RE.sub("", cleaned)

        if HEADING_RE.match(cleaned):
            cleaned = HEADING_RE.sub("", cleaned)
            is_list_like = True

        if UNORDERED_LIST_RE.match(cleaned):
            cleaned = UNORDERED_LIST_RE.sub("", cleaned, count=1)
            is_list_like = True
        elif ORDERED_LIST_RE.match(cleaned):
            cleaned = ORDERED_LIST_RE.sub("", cleaned, count=1)
            is_list_like = True

        cleaned = LINK_RE.sub(r"\1", cleaned)
        cleaned = INLINE_CODE_RE.sub(r"\1", cleaned)
        cleaned = cleaned.replace("**", "")
        cleaned = cleaned.replace("__", "")
        cleaned = cleaned.replace("~~", "")
        cleaned = cleaned.replace("*", "")
        cleaned = cleaned.replace("_", " ")
        cleaned = STANDALONE_MARKERS_RE.sub(" ", cleaned)

    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.strip("-# ")
    return cleaned, is_list_like


def _tokenize(text: str) -> List[str]:
    return [match.group(0) for match in re.finditer(r"\S+", text)]


def _token_duration(token: str) -> float:
    core = TRAILING_EDGE_RE.sub("", token)
    if not core:
        return 0.08

    duration = 0.12 + min(len(core), 16) * 0.028
    if any(char.isdigit() for char in core):
        duration += 0.08

    if token.endswith(("...", "…")):
        duration += 0.28
    elif token.endswith((".", "!", "?")):
        duration += 0.18
    elif token.endswith((",", ";", ":")):
        duration += 0.09

    return round(duration, 3)
