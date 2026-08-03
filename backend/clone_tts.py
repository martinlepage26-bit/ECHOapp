"""Zero-shot / speaker-embedding TTS from local preview samples (no ElevenLabs API).

English voices (echo, martin-en): SpeechT5 + x-vector embeddings extracted from the
reference MP3s under VOICE_SAMPLES_DIR.

French voices (patricia, martin-fr): SpeechT5 is English-only and mispronounces French,
so these go through MeloTTS (correct French synthesis) + OpenVoice V2 tone-color
conversion (puts it in the sample's actual voice) instead. Falls back to a real Piper
fr_FR voice — correct pronunciation, not the sample's voice — if MeloTTS/OpenVoice or
their checkpoints aren't available.

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

# patricia/martin-fr need real French synthesis; SpeechT5 (below) is English-only and
# mispronounces French. Primary path: MeloTTS (correct French text) + OpenVoice V2 tone-color
# conversion (puts it in the sample's actual voice). If either isn't installed or their
# checkpoints aren't present, falls back to a real Piper fr_FR voice (correct pronunciation,
# but a generic voice, not the sample's).
_FRENCH_VOICE_IDS = {"patricia", "martin-fr"}
_FRENCH_PIPER_FALLBACK_VOICE = "fr_FR-tom-medium"

_OPENVOICE_CHECKPOINT_BASE = "https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main"


def _openvoice_checkpoint_dir() -> Path:
    return Path(
        os.environ.get("OPENVOICE_CHECKPOINT_DIR")
        or Path(__file__).parent / ".cache" / "openvoice"
    )


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
        self._french_fallback_voice = None
        self._melo_fr = None
        self._openvoice_converter = None
        self._openvoice_source_se = None
        self._openvoice_target_se: Dict[str, "torch.Tensor"] = {}
        self._openvoice_unavailable_reason: Optional[str] = None

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

    def _ensure_openvoice_loaded(self) -> None:
        """Lazily load MeloTTS (French synthesis) + OpenVoice V2 (tone-color conversion).

        Raises on any failure (missing packages, missing checkpoints); callers must catch
        and fall back to Piper. Checkpoints auto-download from the HF mirror on first use —
        MyShell's own S3 bucket that the upstream docs point at is dead (confirmed 2026-08-02).
        """
        if self._openvoice_converter is not None:
            return

        import torch
        import torch.hub as torch_hub

        # torch.hub prompts interactively to trust the silero-vad repo se_extractor pulls
        # in for voice-activity detection; there is no TTY in a server process to answer it.
        torch_hub._check_repo_is_trusted = lambda *a, **k: None

        from openvoice.api import ToneColorConverter

        ckpt_dir = _openvoice_checkpoint_dir()
        converter_dir = ckpt_dir / "converter"
        fr_se_path = ckpt_dir / "base_speakers" / "ses" / "fr.pth"
        converter_dir.mkdir(parents=True, exist_ok=True)
        fr_se_path.parent.mkdir(parents=True, exist_ok=True)

        self._download_if_missing(
            converter_dir / "checkpoint.pth", f"{_OPENVOICE_CHECKPOINT_BASE}/converter/checkpoint.pth"
        )
        self._download_if_missing(
            converter_dir / "config.json", f"{_OPENVOICE_CHECKPOINT_BASE}/converter/config.json"
        )
        self._download_if_missing(
            fr_se_path, f"{_OPENVOICE_CHECKPOINT_BASE}/base_speakers/ses/fr.pth"
        )

        logger.info("loading MeloTTS (FR) + OpenVoice V2 tone-color converter (first call is slow)...")
        # MeloTTS's import chain pulls in nltk, whose CWE-427 import guard (nltk/inisec.py)
        # blocks any module that resolves to a path under the current working directory.
        # This server runs with cwd=backend/, and backend/.venv/ lives under backend/, so
        # nltk's own dependency (defusedxml) — correctly installed in our own trusted venv —
        # false-positives as a "cwd-hijacked" import. NLTK_DISABLE_IMPORT_SECURITY=1 is
        # nltk's own documented bypass for exactly this false-positive shape.
        os.environ.setdefault("NLTK_DISABLE_IMPORT_SECURITY", "1")

        # melo.text.japanese instantiates a MeCab tagger at import time (even though we
        # only use French) and needs the real unidic dictionary on disk, not just the
        # `unidic` package shell. Fetch it once (~526MB) if missing.
        import unidic

        if not any(Path(unidic.DICDIR).glob("*.bin")):
            import subprocess
            import sys

            logger.info("downloading unidic dictionary (~526MB, one-time, first call is slow)...")
            proc = subprocess.run(
                [sys.executable, "-m", "unidic", "download"], capture_output=True
            )
            if proc.returncode != 0:
                raise RuntimeError(f"unidic download failed: {proc.stderr.decode()[:300]}")

        from melo.api import TTS as MeloTTS

        self._melo_fr = MeloTTS(language="FR", device="cpu")
        converter = ToneColorConverter(str(converter_dir / "config.json"), device="cpu")
        converter.load_ckpt(str(converter_dir / "checkpoint.pth"))
        self._openvoice_converter = converter
        self._openvoice_source_se = torch.load(str(fr_se_path), map_location="cpu")

    @staticmethod
    def _download_if_missing(path: Path, url: str) -> None:
        if path.is_file():
            return
        import httpx

        logger.info("downloading %s -> %s", url, path)
        with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)

    def _target_se_cache_path(self, voice_id: str) -> Path:
        return _openvoice_checkpoint_dir() / "target_se" / f"{voice_id}.pth"

    def _get_or_build_target_se(self, voice_id: str):
        """Speaker embedding for a sample voice, cached to disk after first extraction.

        OpenVoice's default chunker needs the reference clip to be roughly >=5s
        (num_splits = round(duration / 10) must be >=1); ECHO's preview samples are ~4s.
        Loop the clip to ~15s in a temp file before extraction — the embedding is an
        average over speech content, not a duration match, so looping a short clean
        sample is a reasonable way to give the extractor enough material.
        """
        import torch

        if voice_id in self._openvoice_target_se:
            return self._openvoice_target_se[voice_id]

        cache_path = self._target_se_cache_path(voice_id)
        if cache_path.is_file():
            se = torch.load(str(cache_path), map_location="cpu")
            self._openvoice_target_se[voice_id] = se
            return se

        import subprocess
        import tempfile

        from openvoice import se_extractor

        meta = VOICE_CATALOG[voice_id]
        source_path = self.samples_dir / meta[2]
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            looped_path = Path(tmp.name)
        try:
            proc = subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-stream_loop", "3", "-i", str(source_path),
                    "-t", "15", "-c", "copy", str(looped_path),
                ],
                capture_output=True,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg failed to extend {source_path}: {proc.stderr.decode()[:200]}")
            # get_se's own working dir (VAD-split intermediate wavs); redirect into our
            # already-gitignored cache instead of the default `processed/` under cwd.
            scratch_dir = _openvoice_checkpoint_dir() / "processed"
            target_se, name = se_extractor.get_se(
                str(looped_path), self._openvoice_converter, target_dir=str(scratch_dir), vad=True
            )
        finally:
            looped_path.unlink(missing_ok=True)
            import shutil

            shutil.rmtree(scratch_dir / name, ignore_errors=True)

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(target_se, str(cache_path))
        self._openvoice_target_se[voice_id] = target_se
        return target_se

    def _synthesize_openvoice(self, text: str, voice_id: str, speed: float) -> bytes:
        import tempfile

        self._ensure_openvoice_loaded()
        target_se = self._get_or_build_target_se(voice_id)

        speaker_ids = self._melo_fr.hps.data.spk2id
        speaker_id = list(speaker_ids.values())[0]

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            melo_path = Path(tmp.name)
        cloned_path = melo_path.with_suffix(".cloned.wav")
        try:
            self._melo_fr.tts_to_file(text, speaker_id, str(melo_path), speed=speed or 1.0)
            self._openvoice_converter.convert(
                audio_src_path=str(melo_path),
                src_se=self._openvoice_source_se,
                tgt_se=target_se,
                output_path=str(cloned_path),
                message="@MyShell",
            )
            return cloned_path.read_bytes()
        finally:
            melo_path.unlink(missing_ok=True)
            cloned_path.unlink(missing_ok=True)

    def _load_french_fallback_voice(self):
        """Lazily load the Piper fr_FR fallback voice (same resolution as PiperProvider)."""
        if self._french_fallback_voice is None:
            from piper import PiperVoice

            voice_dir = Path(
                os.environ.get("PIPER_VOICE_DIR")
                or Path.home() / ".local" / "share" / "piper-voices"
            )
            path = voice_dir / f"{_FRENCH_PIPER_FALLBACK_VOICE}.onnx"
            if not path.is_file():
                raise RuntimeError(
                    f"French fallback voice model not found: {path}. Download "
                    f"{_FRENCH_PIPER_FALLBACK_VOICE}.onnx (+ .onnx.json) from "
                    f"https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/tom/medium"
                )
            self._french_fallback_voice = PiperVoice.load(str(path))
        return self._french_fallback_voice

    def _synthesize_french_fallback(self, text: str, speed: float) -> bytes:
        from piper import SynthesisConfig

        voice = self._load_french_fallback_voice()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            voice.synthesize_wav(
                text, wf, syn_config=SynthesisConfig(length_scale=1.0 / (speed or 1.0))
            )
        return buf.getvalue()

    def synthesize(self, text: str, voice_id: str, speed: float = 1.0) -> Tuple[bytes, str]:
        """Return (wav_bytes, mime). Speed is currently ignored (open-source path)."""
        text = (text or "").strip()
        if not text:
            raise RuntimeError("Text is required.")

        if voice_id in _FRENCH_VOICE_IDS:
            try:
                return self._synthesize_openvoice(text, voice_id, speed), "audio/wav"
            except Exception as e:
                if self._openvoice_unavailable_reason != str(e):
                    self._openvoice_unavailable_reason = str(e)
                    logger.warning(
                        "OpenVoice V2 synthesis unavailable for voice=%s (%s); "
                        "falling back to Piper fr_FR (correct pronunciation, generic voice).",
                        voice_id, str(e)[:200],
                    )
                return self._synthesize_french_fallback(text, speed), "audio/wav"

        self._ensure_loaded()
        if voice_id not in self._embeddings:
            raise RuntimeError(
                f"Voice {voice_id!r} has no sample under {self.samples_dir}. "
                f"Available: {sorted(self._embeddings)}"
            )
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
