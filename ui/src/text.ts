/** Text normalization and word rendering helpers. */

export function wordCount(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

export function charCount(text: string): number {
  return text.length;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function renderWords(text: string): Array<{ word: string; index: number }> {
  const tokens = text.match(/\S+/g) || [];
  return tokens.map((word, index) => ({ word, index }));
}
