/** Word surface rendering and waveform chrome. */
import {
  DEFAULT_SURFACE_BATCH_SIZE,
  LARGE_SURFACE_BATCH_SIZE,
  LARGE_DRAFT_WORD_THRESHOLD,
} from './config.js';

export function buildWaveformBars(container) {
  container.innerHTML = '';

  const barCount = 22;
  for (let index = 0; index < barCount; index += 1) {
    const bar = document.createElement('span');
    bar.className = 'echo-bar';
    bar.style.setProperty('--echo-bar-height', `${10 + Math.round(Math.sin((index / barCount) * Math.PI) * 22)}px`);
    bar.style.setProperty('--echo-bar-duration', `${(0.45 + Math.random() * 0.45).toFixed(2)}s`);
    container.append(bar);
  }
}

export function setWaveformActive(container, active) {
  container.querySelectorAll('.echo-bar').forEach((bar) => {
    bar.classList.toggle('is-active', active);
  });
}

export function waitForPaint() {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    window.setTimeout(resolve, 16);
  });
}

export async function renderWordSurface(container, text, options = {}) {
  const {
    batchSize = DEFAULT_SURFACE_BATCH_SIZE,
    isStale = () => false,
  } = options;

  container.innerHTML = '';

  if (!text) {
    container.textContent = 'The live reading surface will mirror your text here once you start typing or import a file.';
    return [];
  }

  const wordRanges = [];
  const matcher = /\S+/g;
  let lastIndex = 0;
  let match;
  let fragment = document.createDocumentFragment();
  let wordsInBatch = 0;

  while ((match = matcher.exec(text))) {
    if (isStale()) {
      return null;
    }

    if (match.index > lastIndex) {
      fragment.append(text.slice(lastIndex, match.index));
    }

    const span = document.createElement('span');
    span.className = 'echo-word';
    span.textContent = match[0];
    fragment.append(span);

    wordRanges.push({
      start: match.index,
      end: match.index + match[0].length,
      node: span,
    });

    lastIndex = match.index + match[0].length;
    wordsInBatch += 1;

    if (wordsInBatch >= batchSize) {
      container.append(fragment);
      fragment = document.createDocumentFragment();
      wordsInBatch = 0;
      await waitForPaint();
    }
  }

  if (lastIndex < text.length) {
    fragment.append(text.slice(lastIndex));
  }

  container.append(fragment);
  return wordRanges;
}

export function findWordIndexForChar(wordRanges, charIndex) {
  let low = 0;
  let high = wordRanges.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const range = wordRanges[mid];
    if (range.start <= charIndex) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate < 0) {
    return -1;
  }

  if (charIndex > wordRanges[candidate].end && candidate + 1 < wordRanges.length) {
    return candidate + 1;
  }

  return candidate;
}

