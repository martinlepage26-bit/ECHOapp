"""Zero-shot / speaker-embedding TTS from local preview samples (no ElevenLabs API).

Uses SpeechT5 + x-vector embeddings extracted from reference MP3s under VOICE_SAMPLES_DIR.
Quality is open-source tier (not ElevenLabs), but any text can be read in each sample's
speaker colour without API tokens.
"""

from __future__ import annotations

import io
import logging
import os
import wave
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("echo.clone_tts")

_DEFAULT_CANDIDATES = [
    Path(__file__).resolve().parent / "voices",
    Path.home()
    / "work"
    / "martinlepage26-bit.github.io"
    / "public"
    / "echo"
    / "voices",
]


def _default_samples_dir() -> Path:
    env = os.environ.get("VOICE_SAMPLES_DIR")
    if env:
        return Path(env)
    for candidate in _DEFAULT_CANDIDATES:
        if candidate.is_dir() and any(candidate.glob("*.mp3")):
            return candidate
    return _DEFAULT_CANDIDATES[0]


DEFAULT_SAMPLES_DIR = _default_samples_dir()

# id → (display name, tag, sample filename)
VOICE_CATALOG = {
    "echo": ("Echo", "preview · custom", "echo.mp3"),
    "patricia": ("Patricia", "charming · clear · young", "patricia.mp3"),
    "martin-en": ("Martin EN", "english · custom", "martin-en.mp3"),
    "martin-fr": ("Martin FR", "français · custom", "martin-fr.mp3"),
}


class CloneTTSEngine:
    """Lazy-loaded SpeechT5 engine with cached speaker embeddings."""

    def __init__(self, samples_dir: Optional[Path] = None) -> None:
        self.samples_dir = Path(samples_dir or DEFAULT_SAMPLES_DIR)
        self._ready = False
        self._processor = None
        self._model = None
        self._vocoder = None
        self._spk = None
        self._embeddings: Dict[str, "torch.Tensor"] = {}

    def available_voices(self) -> List[dict]:
        voices = []
        for vid, (name, tag, filename) in VOICE_CATALOG.items():
            path = self.samples_dir / filename
            if path.is_file():
                voices.append({"id": vid, "name": name, "tag": tag, "sample": str(path)})
        return voices

    def has_voice(self, voice_id: str) -> bool:
        meta = VOICE_CATALOG.get(voice_id)
        if not meta:
            return False
        return (self.samples_dir / meta[2]).is_file()

    def _ensure_loaded(self) -> None:
        if self._ready:
            return
        import torch
        from speechbrain.inference.speaker import EncoderClassifier
        from transformers import SpeechT5ForTextToSpeech, SpeechT5HifiGan, SpeechT5Processor

        logger.info("loading SpeechT5 + speaker encoder (first call is slow)...")
        cache = Path(os.environ.get("ECHO_MODEL_CACHE", Path(__file__).parent / ".cache"))
        cache.mkdir(parents=True, exist_ok=True)
        self._spk = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-xvect-voxceleb",
            savedir=str(cache / "spkrec"),
        )
        self._processor = SpeechT5Processor.from_pretrained("microsoft/speecht5_tts")
        self._model = SpeechT5ForTextToSpeech.from_pretrained("microsoft/speecht5_tts")
        self._vocoder = SpeechT5HifiGan.from_pretrained("microsoft/speecht5_hifigan")
        self._model.eval()
        self._vocoder.eval()
        self._torch = torch
        self._ready = True
        logger.info("SpeechT5 ready; precomputing embeddings from %s", self.samples_dir)
        for vid, (_n, _t, filename) in VOICE_CATALOG.items():
            path = self.samples_dir / filename
            if path.is_file():
                self._embeddings[vid] = self._embed_file(path)
                logger.info("embedded voice=%s from %s", vid, path.name)

    def _embed_file(self, path: Path):
        import librosa

        wav, _sr = librosa.load(str(path), sr=16000, mono=True)
        wav_t = self._torch.tensor(wav).unsqueeze(0)
        with self._torch.no_grad():
            emb = self._spk.encode_batch(wav_t).squeeze().float()
        if emb.ndim == 1:
            emb = emb.unsqueeze(0)
        # SpeechT5 expects [1, 512]
        if emb.shape[-1] > 512:
            emb = emb[..., :512]
        elif emb.shape[-1] < 512:
            emb = self._torch.nn.functional.pad(emb, (0, 512 - emb.shape[-1]))
        return emb

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0) -> Tuple[bytes, str]:
        """Return (wav_bytes, mime). Speed is currently ignored (open-source path)."""
        self._ensure_loaded()
        if voice_id not in self._embeddings:
            raise RuntimeError(
                f"Voice {voice_id!r} has no sample under {self.samples_dir}. "
                f"Available: {sorted(self._embeddings)}"
            )
        text = (text or "").strip()
        if not text:
            raise RuntimeError("Text is required.")
        # SpeechT5 is unstable on very long inputs; chunk by sentences.
        chunks = _chunk_text(text, max_chars=280)
        pieces = []
        for chunk in chunks:
            inputs = self._processor(text=chunk, return_tensors="pt")
            with self._torch.no_grad():
                speech = self._model.generate_speech(
                    inputs["input_ids"],
                    self._embeddings[voice_id],
                    vocoder=self._vocoder,
                )
            pieces.append(speech.numpy())
        import numpy as np

        audio = np.concatenate(pieces) if len(pieces) > 1 else pieces[0]
        # simple speed via resample if needed
        if speed and abs(speed - 1.0) > 0.05:
            import librosa

            audio = librosa.effects.time_stretch(audio.astype("float32"), rate=float(speed))
        return _float_to_wav_bytes(audio, 16000), "audio/wav"


def _chunk_text(text: str, max_chars: int = 280) -> List[str]:
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return [text]
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            slice_ = text[start:end]
            cut = max(slice_.rfind(". "), slice_.rfind("! "), slice_.rfind("? "), slice_.rfind(" "))
            if cut > max_chars * 0.4:
                end = start + cut + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks or [text]


def _float_to_wav_bytes(audio, sample_rate: int) -> bytes:
    import numpy as np

    pcm = np.clip(audio, -1.0, 1.0)
    pcm_i16 = (pcm * 32767.0).astype("int16")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_i16.tobytes())
    return buf.getvalue()


_engine: Optional[CloneTTSEngine] = None


def get_clone_engine() -> CloneTTSEngine:
    global _engine
    if _engine is None:
        samples = os.environ.get("VOICE_SAMPLES_DIR")
        _engine = CloneTTSEngine(Path(samples) if samples else None)
    return _engine
