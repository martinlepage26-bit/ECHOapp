"""Execution profile for the existing PHAROS engine; no model or voice assets.

The resident server, reference validation, request guards and synthesis settings
remain owned by PHAROS. This entrypoint runs under its existing LaunchAgent.
"""
import hashlib
from pathlib import Path

BASE_SERVER_SHA = '0a72d10e91a485a44bcd1fc5911404ff38f5c352f13340ce8d21fdf5a1ae2966'
WINDOW = 192
CONTEXT = 32


def require_model_assets(root=None):
    root = root or Path.home() / 'Library/Application Support/tts/tts_models--multilingual--multi-dataset--xtts_v2'
    for name in ('model.pth', 'config.json', 'vocab.json', 'speakers_xtts.pth'):
        path = root / name
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError('Existing PHAROS model assets are missing; no model download is authorized by this profile.')


def windows(length, window=WINDOW, context=CONTEXT):
    """Yield input and output ranges, retaining context around each seam."""
    if length <= 0 or window <= 2 * context or context < 0:
        raise ValueError('Invalid vocoder window.')
    position = 0
    while position < length:
        start = min(max(0, position - context), max(0, length - window))
        end = min(length, start + window)
        finish = length if end == length else end - context
        yield start, end, position, finish
        position = finish


def configure(pharos, torch):
    """Keep FP32 weights and generation settings; change execution only."""
    if not torch.backends.mps.is_available():
        raise RuntimeError('This PHAROS performance profile requires Apple MPS.')
    decoder = pharos.model.hifigan_decoder
    # Weight normalization is constant during inference. Materialize it once on
    # CPU, preserving the effective trained weights, before moving to MPS.
    for module in decoder.waveform_decoder.modules():
        if torch.nn.utils.parametrize.is_parametrized(module, 'weight'):
            torch.nn.utils.parametrize.remove_parametrizations(module, 'weight', leave_parametrized=True)
    pharos.model.to('mps')

    def tiled_decode(latents, g=None):
        # Keep the original global interpolation grid. Small CPU interpolation
        # avoids compiling a new GPU graph for every possible utterance length.
        features = torch.nn.functional.interpolate(
            latents.cpu().transpose(1, 2),
            scale_factor=decoder.ar_mel_length_compression / decoder.output_hop_length,
            mode='linear',
        )
        if decoder.output_sample_rate != decoder.input_sample_rate:
            features = torch.nn.functional.interpolate(
                features, scale_factor=decoder.output_sample_rate / decoder.input_sample_rate,
                mode='linear',
            )
        parts = []
        hop = decoder.output_hop_length
        for start, end, position, finish in windows(features.shape[-1]):
            wave = decoder.waveform_decoder(features[:, :, start:end].contiguous().to('mps'), g=g)
            parts.append(wave[:, :, (position - start) * hop:(finish - start) * hop].cpu())
        return torch.cat(parts, dim=-1)

    decoder.forward = tiled_decode
    pharos.model.inference = torch.inference_mode()(pharos.model.inference)
    return tiled_decode


def main():
    import torch
    if torch.__version__.split('+')[0] != '2.8.0':
        raise RuntimeError('Use the verified PyTorch 2.8.0 environment for this profile.')
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    base = Path(__file__).with_name('server.py')
    if hashlib.sha256(base.read_bytes()).hexdigest() != BASE_SERVER_SHA:
        raise RuntimeError('PHAROS server changed; review this execution profile before using it.')
    require_model_assets()
    import server as pharos
    configure(pharos, torch)
    print('Warming PHAROS speech kernels...', flush=True)
    pharos.model.inference(
        'The reader is ready to speak clearly and continue through the next paragraph.',
        'en', pharos.gpt_cond_latent, pharos.speaker_embedding,
        temperature=pharos.cfg.temperature, length_penalty=pharos.cfg.length_penalty,
        repetition_penalty=pharos.cfg.repetition_penalty,
        top_k=pharos.cfg.top_k, top_p=pharos.cfg.top_p, enable_text_splitting=True,
    )
    profile_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    class Handler(pharos.Handler):
        def do_GET(self):
            if self.path == '/health' and pharos.echo_guard.host_ok(self.headers.get('Host')):
                self._json(200, {'status': 'ok', 'engine': 'echo-gpu-v1', 'profile_sha256': profile_sha})
            else:
                super().do_GET()

    print('PHAROS GPU execution profile ready; original voice and request guards retained.', flush=True)
    pharos.ThreadingHTTPServer(('127.0.0.1', pharos.PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
