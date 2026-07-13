import { expect, test } from '@playwright/test';

const SOURCE_TEXT = `# Heading

This sentence starts here
and keeps going across the line break without sounding broken.

- bullet one
- bullet two`;

const CLEAN_WORDS = [
  'Heading.',
  'This',
  'sentence',
  'starts',
  'here',
  'and',
  'keeps',
  'going',
  'across',
  'the',
  'line',
  'break',
  'without',
  'sounding',
  'broken.',
  'bullet',
  'one.',
  'bullet',
  'two.',
];

test.describe('ECHOapp web readback', () => {
  test('prefers echo voice and keeps the final highlight at playback completion', async ({ page }) => {
    test.slow();

    const ttsRequests: Array<{ text: string; voice_id: string; speed: number }> = [];

    await page.addInitScript(({ words }) => {
      class FakeAudio {
        static DURATION_SECONDS = 1.9;

        _listeners = new Map<string, Set<(...args: unknown[]) => void>>();
        _tickTimer: number | null = null;
        _endTimer: number | null = null;
        currentTime = 0;
        duration = FakeAudio.DURATION_SECONDS;
        paused = true;
        ended = false;
        preload = 'auto';
        autoplay = false;
        onended: null | (() => void) = null;

        addEventListener(type: string, listener: (...args: unknown[]) => void) {
          if (!this._listeners.has(type)) {
            this._listeners.set(type, new Set());
          }
          this._listeners.get(type)?.add(listener);
        }

        removeEventListener(type: string, listener: (...args: unknown[]) => void) {
          this._listeners.get(type)?.delete(listener);
        }

        dispatch(type: string) {
          const event = { type, target: this };
          for (const listener of this._listeners.get(type) ?? []) {
            listener(event);
          }
          if (type === 'ended') {
            this.onended?.();
          }
        }

        load() {
          window.setTimeout(() => this.dispatch('loadedmetadata'), 0);
        }

        pause() {
          this.paused = true;
          if (this._tickTimer != null) {
            window.clearInterval(this._tickTimer);
            this._tickTimer = null;
          }
          if (this._endTimer != null) {
            window.clearTimeout(this._endTimer);
            this._endTimer = null;
          }
          this.dispatch('pause');
        }

        removeAttribute(_name: string) {}

        async play() {
          this.paused = false;
          this.ended = false;
          const startedAt = Date.now() - this.currentTime * 1000;

          this.dispatch('play');
          if (this._tickTimer != null) {
            window.clearInterval(this._tickTimer);
          }
          if (this._endTimer != null) {
            window.clearTimeout(this._endTimer);
          }

          this._tickTimer = window.setInterval(() => {
            this.currentTime = Math.min((Date.now() - startedAt) / 1000, this.duration);
          }, 40);

          this._endTimer = window.setTimeout(() => {
            if (this._tickTimer != null) {
              window.clearInterval(this._tickTimer);
              this._tickTimer = null;
            }
            this.currentTime = this.duration;
            this.paused = true;
            this.ended = true;
            this.dispatch('ended');
          }, this.duration * 1000);
        }
      }

      Object.defineProperty(window, 'Audio', {
        configurable: true,
        writable: true,
        value: FakeAudio,
      });

      (window as typeof window & { __echoWords?: string[] }).__echoWords = words;
    }, { words: CLEAN_WORDS });

    await page.route('**/api/voices', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          voices: [
            { id: 'ash', name: 'Ash', tag: 'clear · articulate' },
            { id: 'echo', name: 'Echo', tag: 'smooth · calm' },
          ],
          default: 'ash',
        }),
      });
    });

    await page.route('**/api/tts/generate', async (route) => {
      const payload = route.request().postDataJSON() as { text: string; voice_id: string; speed: number };
      ttsRequests.push(payload);

      const estimatedDuration = 1.9;
      const perWord = estimatedDuration / CLEAN_WORDS.length;
      const words = CLEAN_WORDS.map((word, index) => ({
        word,
        index,
        start: Number((index * perWord).toFixed(3)),
        end: Number(((index + 1) * perWord).toFixed(3)),
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          audio_base64: 'SUQzBAAA',
          mime: 'audio/mpeg',
          voice_id: payload.voice_id,
          word_count: words.length,
          char_count: payload.text.length,
          words,
          estimated_duration: estimatedDuration,
        }),
      });
    });

    await page.goto('/readback');

    await expect(page.getByTestId('voice-chip-echo')).toBeVisible();
    await expect(page.getByTestId('voice-chip-echo')).toContainText('Echo');

    await page.getByTestId('text-intake-input').fill(SOURCE_TEXT);
    await page.getByTestId('play-pause-button').click();

    await expect.poll(() => ttsRequests.length).toBe(1);
    expect(ttsRequests[0]?.voice_id).toBe('echo');

    await expect(page.getByTestId('playback-hint')).toContainText('Audio ready. Press PLAY to start readback.');

    await page.getByTestId('play-pause-button').click();

    await expect(page.getByTestId('readback-pane')).toContainText('Heading. This sentence starts here');
    await expect(page.getByTestId('readback-pane')).toContainText('bullet one. bullet two.');

    const readbackText = await page.getByTestId('readback-pane').innerText();
    expect(readbackText).not.toContain('# Heading');
    expect(readbackText).not.toContain('- bullet one');

    await expect
      .poll(async () => ((await page.getByTestId('active-readback-word').textContent()) ?? '').trim(), {
        timeout: 2500,
      })
      .not.toBe('');

    await expect
      .poll(async () => ((await page.getByTestId('active-readback-word').textContent()) ?? '').trim(), {
        timeout: 4000,
      })
      .toBe('two.');

    await expect
      .poll(async () => ((await page.getByTestId('readback-pane').innerText()) ?? '').trim(), { timeout: 4000 })
      .toContain('bullet two.');
  });
});
