/**
 * drafts.js — the drafts library, kept in this browser.
 *
 * The base44 build stored drafts on its platform; self-hosted there is no
 * account to attach them to, so they live in localStorage and never leave the
 * device. Storage failures are never fatal to reading.
 */

const KEY = 'echo.drafts.v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;   // private browsing, or quota exhausted
  }
}

export function listDrafts() {
  return read().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function saveDraft(text, title) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const draft = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: (title || trimmed.slice(0, 60).replace(/\s+/g, ' ')).trim(),
    text: trimmed,
    savedAt: Date.now(),
  };
  const list = read();
  list.unshift(draft);
  // Keep the library bounded so a few long documents cannot exhaust the quota.
  while (list.length > 50) list.pop();
  if (!write(list)) {
    throw new Error('This browser will not store drafts — private mode, or storage is full.');
  }
  return draft;
}

export function deleteDraft(id) {
  write(read().filter((d) => d.id !== id));
}

export function relativeTime(ms) {
  if (!ms) return '';
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']];
  let value = seconds / 60;
  let unit = 'minute';
  for (const [size, name] of steps) {
    unit = name;
    if (Math.abs(value) < size || name === 'month') break;
    value /= size;
  }
  const n = Math.round(value);
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}
