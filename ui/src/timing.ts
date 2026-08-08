/** Estimated word timings for client-side speech highlighting. */

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  index: number;
}

export interface TimingResult {
  words: WordTiming[];
  estimated_duration: number;
}

export function estimateWordTimings(text: string): TimingResult {
  const tokens = String(text || "").match(/\S+/g) || [];
  let cursor = 0;
  const words = tokens.map((word, index) => {
    const core = word.replace(/^[^\w]+|[^\w]+$/g, "");
    let duration = 0.12 + Math.min(core.length || 1, 16) * 0.028;
    if (/\d/.test(core)) duration += 0.08;
    if (/\.\.\.$|…$/.test(word)) duration += 0.28;
    else if (/[.!?]$/.test(word)) duration += 0.18;
    else if (/[,;:]$/.test(word)) duration += 0.09;
    const start = Number(cursor.toFixed(3));
    cursor += duration;
    return { word, start, end: Number(cursor.toFixed(3)), index };
  });
  return { words, estimated_duration: Number(cursor.toFixed(3)) };
}
