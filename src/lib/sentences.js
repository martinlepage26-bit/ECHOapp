/**
 * sentences.js — split prose into speakable sentences with their character
 * ranges in the source text.
 *
 * The sentence is ECHO's unit of work: one utterance, one highlight, one seek
 * target. Splitting has to survive decimals, abbreviations, initials and URLs,
 * because a false break mid-number is exactly what makes a reader lose the thread.
 */

/** Abbreviations whose period does not end a sentence. */
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'st', 'jr', 'sr', 'esq',
  'inc', 'ltd', 'llc', 'corp', 'co', 'dept', 'univ', 'assn', 'bros',
  'ave', 'blvd', 'rd', 'apt', 'no', 'nos', 'vol', 'vols', 'fig', 'figs',
  'pp', 'ed', 'eds', 'trans', 'et', 'al', 'etc', 'vs', 'viz', 'cf', 'ca',
  'approx', 'est', 'min', 'max', 'sec', 'ref', 'sn',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'am', 'pm', 'a.m', 'p.m', 'i.e', 'e.g', 'u.s', 'u.k', 'ph.d', 'm.d', 'b.a', 'm.a',
  // French
  'm', 'mme', 'mlle', 'me', 'dr', 'pr', 'av', 'boul', 'ch', 'app', 'bur',
  'env', 'réf', 'tél', 'janv', 'févr', 'avr', 'juil', 'déc',
]);

/** Longest sentence we will hand to the synthesiser before forcing a break. */
const MAX_SENTENCE = 400;
const SOFT_BREAK = /[,;:—–)]\s/g;

const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '؟']);
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '}', '…']);

/**
 * Abbreviations that often sit at the end of a clause. Unlike a title such as
 * "Dr.", which is always followed by a name, these can genuinely close a
 * sentence: "Acme Inc. The meeting starts now." is two sentences.
 */
const MAY_END_SENTENCE = new Set([
  'etc', 'al', 'inc', 'ltd', 'llc', 'corp', 'co', 'jr', 'sr',
  'ibid', 'est', 'u.s', 'u.k', 'ph.d', 'm.d', 'b.a', 'm.a',
]);

function isAbbreviation(text, dotIndex) {
  // Walk back over the word carrying the period.
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-zÀ-ÿ.]/.test(text[i])) i--;
  const word = text.slice(i + 1, dotIndex).toLowerCase().replace(/\.$/, '');
  if (!word) return false;
  // A single letter is an initial: "J. R. R. Tolkien".
  if (word.length === 1) return true;
  if (!ABBREV.has(word)) return false;

  if (MAY_END_SENTENCE.has(word)) {
    const following = text.slice(dotIndex + 1).match(/^\s+["'“‘(]?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.]*)/);
    const nextWord = following ? following[1] : '';
    const head = nextWord.charAt(0);
    // A capitalised next word starts a new sentence — unless it is itself an
    // abbreviation, as in "Acme Co. Ltd.".
    if (head && head === head.toUpperCase() && head !== head.toLowerCase()) {
      const bare = nextWord.toLowerCase().replace(/\.$/, '');
      if (!ABBREV.has(bare)) return false;
    }
  }
  return true;
}

/**
 * Split `text` into sentences.
 * Each entry is `{ text, start, end, index, paraBreak }`, where `paraBreak` is
 * the number of blank lines that preceded it (used for paragraph spacing).
 */
export function splitSentences(text) {
  const out = [];
  if (!text) return out;

  const n = text.length;
  let start = 0;
  let pendingBreaks = 0;

  const push = (from, to, breaks) => {
    const raw = text.slice(from, to);
    if (!raw.trim()) return false;
    // Trim to the actual content, but keep the offsets pointing at the source.
    const lead = raw.length - raw.replace(/^\s+/, '').length;
    const trail = raw.length - raw.replace(/\s+$/, '').length;
    out.push({
      text: raw.slice(lead, raw.length - trail),
      start: from + lead,
      end: to - trail,
      index: out.length,
      paraBreak: breaks,
    });
    return true;
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i];

    if (ch === '\n') {
      // A line ending always closes a sentence; count consecutive blanks.
      let j = i;
      let newlines = 0;
      while (j < n && /[\r\n\t ]/.test(text[j])) {
        if (text[j] === '\n') newlines++;
        j++;
      }
      if (push(start, i, pendingBreaks)) pendingBreaks = 0;
      pendingBreaks += Math.max(0, newlines - 1);
      start = j;
      i = j - 1;
      continue;
    }

    if (!TERMINATORS.has(ch)) continue;

    if (ch === '.') {
      const prev = text[i - 1];
      const next = text[i + 1];
      // 3.14, 192.168.1.1, v2.1.0 — a period between digits is never a stop.
      if (/\d/.test(prev || '') && /\d/.test(next || '')) continue;
      // example.com, file.txt — a period glued to a following word.
      if (next && /[A-Za-z0-9]/.test(next)) continue;
      if (isAbbreviation(text, i)) continue;
      // Ellipsis: consume the whole run, then judge it by what follows.
      // "Then... it arrived." trails off and continues; "Then... It arrived."
      // starts a new sentence.
      if (next === '.') {
        while (i + 1 < n && text[i + 1] === '.') i++;
        const after = text.slice(i + 1).match(/^\s*(\S)/);
        if (after && /[a-zà-ÿ,;]/.test(after[1])) continue;
      }
    }

    // Absorb closing quotes and brackets that belong to this sentence.
    let end = i + 1;
    while (end < n && CLOSERS.has(text[end])) end++;
    // Require whitespace or end-of-text after the terminator.
    if (end < n && !/\s/.test(text[end])) continue;

    if (push(start, end, pendingBreaks)) pendingBreaks = 0;
    start = end;
  }

  if (start < n) push(start, n, pendingBreaks);

  // A forced split turns one sentence into several, so renumber afterwards:
  // `index` must stay the position in the returned array.
  return out.flatMap(splitOverlong).map((piece, i) => (piece.index === i ? piece : { ...piece, index: i }));
}

/**
 * Break a sentence that never terminates — a list item, a caption, a wall of
 * text pasted without punctuation — at the nearest soft boundary.
 */
function splitOverlong(sentence) {
  if (sentence.text.length <= MAX_SENTENCE) return [sentence];

  const pieces = [];
  let offset = 0;
  const { text } = sentence;

  while (offset < text.length) {
    if (text.length - offset <= MAX_SENTENCE) {
      pieces.push([offset, text.length]);
      break;
    }
    const window = text.slice(offset, offset + MAX_SENTENCE);
    SOFT_BREAK.lastIndex = 0;
    let cut = -1;
    let m;
    while ((m = SOFT_BREAK.exec(window)) !== null) {
      if (m.index > MAX_SENTENCE * 0.4) cut = m.index + 1;
    }
    if (cut < 0) cut = window.lastIndexOf(' ', MAX_SENTENCE);
    if (cut < MAX_SENTENCE * 0.3) cut = MAX_SENTENCE;
    pieces.push([offset, offset + cut]);
    offset += cut;
  }

  return pieces
    .map(([a, b], k) => {
      // Trimming the piece has to move its offsets too, or slice(start, end)
      // on the source no longer returns the piece.
      const raw = text.slice(a, b);
      const lead = raw.length - raw.replace(/^\s+/, '').length;
      const trail = raw.length - raw.replace(/\s+$/, '').length;
      return {
        text: raw.slice(lead, raw.length - trail),
        start: sentence.start + a + lead,
        end: sentence.start + b - trail,
        index: sentence.index,
        paraBreak: k === 0 ? sentence.paraBreak : 0,
      };
    })
    .filter((s) => s.text)
    .map((s, k, arr) => ({ ...s, continued: k < arr.length - 1 }));
}

/** Word count that matches what a reader would tally. */
export function countWords(text) {
  if (!text) return 0;
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu);
  return m ? m.length : 0;
}
