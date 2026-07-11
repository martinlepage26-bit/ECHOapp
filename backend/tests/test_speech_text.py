import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from speech_text import estimate_word_timings, normalize_tts_text


def test_normalize_tts_text_strips_markdown_markers():
    source = """
    # Heading

    - first bullet
    - second bullet with **bold** text
    ---
    [Link label](https://example.com)
    """

    normalized = normalize_tts_text(source)

    assert "#" not in normalized
    assert "---" not in normalized
    assert normalized.startswith("Heading.")
    assert "first bullet." in normalized
    assert "second bullet with bold text." in normalized
    assert "Link label" in normalized


def test_estimate_word_timings_are_monotonic():
    timings, total_duration = estimate_word_timings("Echo reads this cleanly.")

    assert total_duration > 0
    assert [timing.word for timing in timings] == ["Echo", "reads", "this", "cleanly."]
    assert timings[0].start == 0

    for previous, current in zip(timings, timings[1:]):
        assert previous.end <= current.start

    assert timings[-1].end == total_duration
