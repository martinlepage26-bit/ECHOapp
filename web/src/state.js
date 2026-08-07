/** localStorage draft persistence. */
import { STORAGE_KEY } from './config.js';

export function loadStoredState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function storeState(payload) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage is a convenience only
  }
}

export function clearStoredDraftText() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    delete parsed.text;
    parsed.keepDraft = false;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage cleanup is best-effort
    }
  }
}

