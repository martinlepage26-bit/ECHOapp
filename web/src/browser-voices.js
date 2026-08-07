/** Browser speechSynthesis voice matching and select helpers. */
import { findProfile } from './profiles.js';
import { SYSTEM_PROFILE_ID } from './config.js';
import { extensionFromFilename, countWords, formatMinutes, estimateMinutes } from './text.js';

export function chooseVoiceForProfile(availableVoices, profileId) {
  if (!availableVoices.length) {
    return null;
  }

  const profile = findProfile(profileId);
  const navigatorLanguages = Array.isArray(window.navigator.languages)
    ? window.navigator.languages.map((entry) => entry.toLowerCase())
    : [String(window.navigator.language || '').toLowerCase()];

  let bestVoice = availableVoices[0];
  let bestScore = -Infinity;

  for (const voice of availableVoices) {
    const name = String(voice.name || '').toLowerCase();
    const lang = String(voice.lang || '').toLowerCase();
    let score = 0;

    if (voice.default) score += 6;
    if (voice.localService) score += 4;
    if (profile.langPrefixes.some((prefix) => lang.startsWith(prefix))) score += 9;
    if (navigatorLanguages.some((entry) => lang.startsWith(entry.slice(0, 2)))) score += 3;

    profile.nameHints.forEach((hint, index) => {
      if (name.includes(hint)) {
        score += 14 - index;
      }
    });

    if (score > bestScore) {
      bestVoice = voice;
      bestScore = score;
    }
  }

  return bestVoice;
}

export function formatVoiceMeta(voice, totalVoices) {
  if (!voice) {
    return totalVoices
      ? `${totalVoices} browser/system voices detected.`
      : 'No system voices are available yet.';
  }

  const tags = [voice.lang || 'unknown language'];
  if (voice.default) {
    tags.push('default');
  }
  if (voice.localService) {
    tags.push('local');
  }

  return `${voice.name} · ${tags.join(' · ')} · ${totalVoices} voices available on this device`;
}

export function safeFileMeta(file, extractedText) {
  if (!file) {
    return 'No file selected yet.';
  }

  const ext = extensionFromFilename(file.name);
  const sizeKb = Math.max(1, Math.round(file.size / 1024));
  return `${file.name} · ${ext || 'unknown'} · ${sizeKb} KB · ${countWords(extractedText)} words`;
}

export function setVoiceSelectPlaceholder(select, label) {
  select.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = label;
  select.append(option);
  select.value = '';
  select.disabled = true;
}

