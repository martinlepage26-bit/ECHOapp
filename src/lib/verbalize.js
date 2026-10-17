/**
 * verbalize.js — turns written notation into the words a person would say.
 *
 * Speech engines read "$1,234.56" as "dollar one comma two three four point
 * five six" and "A4-9920-XJ" as noise. This module rewrites a sentence into
 * its spoken form before it reaches the synthesiser, so amounts, money,
 * serial numbers, dates, ranges and units come out intelligible.
 *
 * Pure and DOM-free — the node test suite drives it directly.
 */

import { intToWords, spellDigits, ordinalToWords, yearToWords } from './numbers.js';
import {
  CURRENCY, CURRENCY_CODES, SUBUNIT, SCALE_SUFFIX, FR_INVARIABLE_SCALES, UNITS,
  SYMBOLS, ABBREVIATIONS, MONTHS, YEAR_CUES, SERIAL_CUES,
} from './dictionaries.js';

const THIN_SPACES = /[    ]/g;

/** Languages with full number-to-words support. Others pass through lightly. */
export const SUPPORTED = new Set(['en', 'fr']);

/** Normalise a tag to a supported code, so fr-CA and fr-FR both read as French. */
const L = (lang) => (String(lang || 'en').slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en');

const T = {
  en: { and: 'and', to: 'to', of: 'of', dash: 'dash', slash: 'slash', dot: 'dot',
        underscore: 'underscore', colon: 'colon', at: 'at', negative: 'minus',
        plus: 'plus', percent: 'percent', version: 'version', oclock: "o'clock",
        oh: 'oh', point: 'point', over: 'over', per: 'per' },
  fr: { and: 'et', to: 'à', of: 'de', dash: 'tiret', slash: 'barre oblique', dot: 'point',
        underscore: 'tiret bas', colon: 'deux-points', at: 'arobase', negative: 'moins',
        plus: 'plus', percent: 'pour cent', version: 'version', oclock: 'heures',
        oh: 'zéro', point: 'virgule', over: 'sur', per: 'par' },
};

const pick = (pair, count) => (Math.abs(count) === 1 ? pair[0] : pair[1]);

/** "2,5 M" → "deux virgule cinq millions"; English scale words never inflect. */
function scaleWord(key, lang, count) {
  const word = SCALE_SUFFIX[key]?.[L(lang)];
  if (!word) return null;
  if (L(lang) !== 'fr' || FR_INVARIABLE_SCALES.has(word) || Math.abs(count) < 2) return word;
  return `${word}s`;
}

/* ── Number parsing ──────────────────────────────────────────────────── */

const EURO_STYLE = new Set(['fr', 'de', 'es', 'it', 'pt', 'nl', 'ru', 'pl', 'tr']);

/**
 * Split a written number into sign / integer digits / fraction digits,
 * resolving "," and "." against the document language.
 * Returns null when the string is not a number.
 */
export function parseNumber(input, lang = 'en') {
  let str = String(input).replace(THIN_SPACES, ' ').trim();
  if (!str) return null;

  let sign = '';
  if (/^[+\-−–]/.test(str)) { sign = /^[+]/.test(str) ? '+' : '-'; str = str.slice(1).trim(); }
  if (!/^\d[\d., ]*$/.test(str) || !/\d$/.test(str)) return null;

  const euro = EURO_STYLE.has(lang);
  const dots = (str.match(/\./g) || []).length;
  const commas = (str.match(/,/g) || []).length;
  let decSep = null;

  if (dots && commas) {
    // Whichever appears last is the decimal mark: 1.234,56 vs 1,234.56
    decSep = str.lastIndexOf('.') > str.lastIndexOf(',') ? '.' : ',';
  } else if (dots === 1 || commas === 1) {
    const sep = dots ? '.' : ',';
    const tail = str.slice(str.lastIndexOf(sep) + 1);
    // A lone separator with exactly three trailing digits is a thousands mark
    // in the style that uses it that way, a decimal mark in the other.
    const groupsLikeThousands = tail.length === 3 && /^\d{3}$/.test(tail);
    const sepIsThousands = sep === (euro ? '.' : ',');
    decSep = groupsLikeThousands && sepIsThousands ? null : sep;
  }
  // Two or more of the same separator can only be thousands grouping.

  let intPart = str, fracPart = '';
  if (decSep) {
    const i = str.lastIndexOf(decSep);
    intPart = str.slice(0, i);
    fracPart = str.slice(i + 1);
  }
  intPart = intPart.replace(/[., ]/g, '');
  if (!/^\d+$/.test(intPart)) return null;
  if (fracPart && !/^\d+$/.test(fracPart)) return null;

  return { sign, int: intPart, frac: fracPart, value: Number(`${intPart}.${fracPart || 0}`) };
}

/** Spoken form of a parsed number, digits after the mark read one by one. */
function sayNumber(n, lang) {
  const t = T[L(lang)];
  const head = n.sign === '-' ? `${t.negative} ` : n.sign === '+' ? `${t.plus} ` : '';
  const whole = intToWords(n.int, lang);
  if (!n.frac) return head + whole;
  return `${head}${whole} ${t.point} ${spellDigits(n.frac, lang)}`;
}

/* ── Token anatomy ───────────────────────────────────────────────────── */

const LEAD_PUNCT = /^[\s"'“”‘’«»¿¡(\[{]+/;
const TRAIL_PUNCT = /[\s"'“”‘’«»)\]}.,;:!?…]+$/;

function peel(raw) {
  const lead = (raw.match(LEAD_PUNCT) || [''])[0];
  let rest = raw.slice(lead.length);
  const trail = (rest.match(TRAIL_PUNCT) || [''])[0];
  rest = rest.slice(0, rest.length - trail.length);
  return { lead, core: rest, trail };
}

// Alternation bodies kept as plain strings so composed patterns keep a stable
// capture-group numbering — multi-char symbols must precede their prefixes.
const CUR_SYM = 'CA\\$|C\\$|US\\$|A\\$|NZ\\$|HK\\$|R\\$|[$€£¥₹¢₩₽₪₺฿₫₦₱₴₡]';
const CUR_CODE = 'USD|CAD|EUR|GBP|JPY|CNY|AUD|NZD|CHF|SEK|NOK|DKK|MXN|BRL|INR|KRW|ZAR|HKD|SGD|PLN|RUB|TRY|ILS|AED|SAR';
const CUR_ANY = `${CUR_SYM}|${CUR_CODE}`;
const NUM_RE = '\\d[\\d., \\u00A0\\u202F\\u2009]*\\d|\\d';
const SCALE_KEYS = Object.keys(SCALE_SUFFIX).sort((a, b) => b.length - a.length).join('|');
// "5 in" may well be "5 in total", so single-letter and word-shaped unit
// abbreviations are only honoured when written flush against the number.
const AMBIGUOUS_UNITS = new Set(['in', 'm', 't', 's', 'b', 'B', 'A', 'V', 'W', 'L', 'g', 'h', 'pt', 'sec', 'min', 'ha', 'mi']);
const SAFE_UNIT_KEYS = Object.keys(UNITS)
  .filter((k) => !AMBIGUOUS_UNITS.has(k))
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  .join('|');

const CUR_CODE_RE = new RegExp(`^(?:${CUR_CODE})$`);

function currencyNames(key, lang) {
  const entry = CURRENCY[key] || CURRENCY_CODES[key];
  return entry ? entry[L(lang)] : null;
}

function subunitNames(key, lang) {
  const entry = SUBUNIT[key] || SUBUNIT.default;
  return entry[L(lang)];
}

/** "$1,234.56" → "one thousand two hundred thirty-four dollars and fifty-six cents" */
function sayMoney(curKey, numStr, scaleKey, lang) {
  const n = parseNumber(numStr, lang);
  if (!n) return null;
  const t = T[L(lang)];
  const names = currencyNames(curKey, lang);
  if (!names) return null;

  if (scaleKey) {
    const scale = scaleWord(scaleKey, lang, n.value);
    if (!scale) return null;
    // French links a scale word to its noun: "deux millions de dollars".
    const link = L(lang) === 'fr' ? `${t.of} ` : '';
    return `${sayNumber(n, lang)} ${scale} ${link}${names[1]}`;
  }

  // Exactly two decimals on money reads as sub-units, not as loose digits.
  if (n.frac && n.frac.length <= 2) {
    const cents = Number(n.frac.length === 1 ? `${n.frac}0` : n.frac);
    const sub = subunitNames(curKey, lang);
    const majorCount = Number(n.int);
    const head = n.sign === '-' ? `${t.negative} ` : '';
    const centWords = `${intToWords(String(cents), lang)} ${pick(sub, cents)}`;
    // Under one unit, only the sub-unit is spoken: "$0.99" → "ninety-nine cents".
    if (majorCount === 0 && cents > 0) return head + centWords;
    const major = `${intToWords(n.int, lang)} ${pick(names, majorCount)}`;
    if (cents === 0) return head + major;
    return `${head}${major} ${t.and} ${centWords}`;
  }

  return `${sayNumber(n, lang)} ${pick(names, n.value)}`;
}

/* ── Serial numbers and mixed alphanumeric codes ─────────────────────── */

const VOWELS = /[aeiouyàâäéèêëïîôöùûüÿ]/i;
const SEP_WORD = { '-': 'dash', '–': 'dash', '—': 'dash', '/': 'slash', '.': 'dot', '_': 'underscore', ':': 'colon' };

function runsOf(core) {
  return core.match(/[A-Za-zÀ-ÿ]+|\d+|[^A-Za-zÀ-ÿ\d]/g) || [];
}

/**
 * A token reads as a serial when it mixes letters and digits and at least one
 * letter run is too short or too consonant-heavy to be a word — "A4-9920-XJ"
 * and "SN12345" qualify, "COVID-19" and "iPhone15" do not.
 */
export function looksLikeSerial(core) {
  if (!/^[A-Za-z0-9][A-Za-z0-9\-\/._:]*$/.test(core)) return false;
  if (!/[A-Za-z]/.test(core) || !/\d/.test(core)) return false;
  if (core.length < 2) return false;
  const alphaRuns = core.match(/[A-Za-z]+/g) || [];
  return alphaRuns.some((r) => r.length <= 3 || !VOWELS.test(r));
}

function saySerial(core, lang) {
  const t = T[L(lang)];
  const out = [];
  for (const run of runsOf(core)) {
    if (/^\d+$/.test(run)) {
      out.push(spellDigits(run, lang));
    } else if (/^[A-Za-zÀ-ÿ]+$/.test(run)) {
      // Short or vowel-free runs are spelled letter by letter.
      out.push(run.length <= 3 || !VOWELS.test(run) ? run.toUpperCase().split('').join(' ') : run);
    } else if (SEP_WORD[run]) {
      out.push(t[SEP_WORD[run]]);
    }
  }
  return out.join(' ');
}

/** Word-shaped mixed tokens: "COVID-19" → "COVID nineteen". */
function sayMixedWord(core, lang) {
  const out = [];
  for (const run of runsOf(core)) {
    if (/^\d+$/.test(run)) out.push(intToWords(run, lang) || run);
    else if (/^[A-Za-zÀ-ÿ]+$/.test(run)) out.push(run);
    else if (run === '-' || run === '–') out.push(' ');
    else if (SEP_WORD[run]) out.push(T[L(lang)][SEP_WORD[run]]);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/* ── Individual matchers ─────────────────────────────────────────────── */
/* Each returns a spoken string, or null to decline. Order matters. */

function matchUrlOrEmail(core, lang) {
  const t = T[L(lang)];
  const isEmail = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(core);
  const isUrl = /^(https?:\/\/|www\.)/i.test(core) ||
    /^[\w.-]+\.(com|org|net|ca|io|ai|dev|app|co|fr|uk|edu|gov|info|me|xyz|tech)(\/\S*)?$/i.test(core);
  if (!isEmail && !isUrl) return null;

  const speakChunk = (chunk) =>
    (chunk.length <= 3 || !VOWELS.test(chunk)) && /^[A-Za-z]+$/.test(chunk)
      ? chunk.toUpperCase().split('').join(' ')
      : chunk;

  return core
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .split(/([@./\-_:])/)
    .map((part) => {
      if (part === '@') return t.at;
      if (part === '.') return t.dot;
      if (part === '/') return t.slash;
      if (part === '-') return t.dash;
      if (part === '_') return t.underscore;
      if (part === ':') return t.colon;
      if (/^\d+$/.test(part)) return spellDigits(part, lang);
      return speakChunk(part);
    })
    .filter(Boolean)
    .join(' ');
}

function matchTime(core, lang, next) {
  const m = core.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(\s*[ap]\.?m\.?)?$/i);
  if (!m) return null;
  const t = T[L(lang)];
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : null;
  if (h > 23 || min > 59) return null;

  let meridiem = (m[4] || '').replace(/[.\s]/g, '').toUpperCase();
  if (!meridiem && next && /^[ap]\.?m\.?$/i.test(next)) meridiem = next.replace(/[.\s]/g, '').toUpperCase();

  const parts = [intToWords(String(h), lang)];
  if (lang === 'fr') {
    parts.push(h === 1 ? 'heure' : 'heures');
    if (min) parts.push(intToWords(String(min), lang));
  } else if (min === 0) {
    parts.push(sec == null ? t.oclock : '');
  } else if (min < 10) {
    parts.push(t.oh, intToWords(String(min), lang));
  } else {
    parts.push(intToWords(String(min), lang));
  }
  if (sec != null) parts.push(t.and, intToWords(String(sec), lang), lang === 'fr' ? 'secondes' : 'seconds');
  if (meridiem) parts.push(meridiem.split('').join(' '));
  return parts.filter(Boolean).join(' ');
}

function sayDate(y, mo, d, lang) {
  const month = MONTHS[L(lang)][mo - 1];
  if (!month) return null;
  if (lang === 'fr') {
    const day = d === 1 ? 'premier' : intToWords(String(d), 'fr');
    return `${day} ${month} ${yearToWords(y, 'fr')}`;
  }
  return `${month} ${ordinalToWords(d, 'en')}, ${yearToWords(y, 'en')}`;
}

function matchIsoDate(core, lang) {
  const m = core.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return sayDate(y, mo, d, lang);
}

function matchSlashDate(core, lang) {
  const m = core.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (!m) return null;
  let a = Number(m[1]), b = Number(m[2]);
  let y = Number(m[3]);
  if (m[3].length === 2) y += y < 50 ? 2000 : 1900;
  // Day-first outside the US convention; a value over 12 settles it either way.
  let d, mo;
  if (a > 12) { d = a; mo = b; }
  else if (b > 12) { mo = a; d = b; }
  else if (lang === 'en') { mo = a; d = b; }
  else { d = a; mo = b; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return sayDate(y, mo, d, lang);
}

function matchVersion(core, lang) {
  const m = core.match(/^v(?:ersion)?[.\s]?(\d+(?:\.\d+){1,3})$/i);
  const bare = core.match(/^(\d+(?:\.\d+){2,3})$/);
  const digits = m ? m[1] : bare ? bare[1] : null;
  if (!digits) return null;
  const t = T[L(lang)];
  const spoken = digits.split('.').map((p) => intToWords(p, lang)).join(` ${t.point} `);
  return m ? `${t.version} ${spoken}` : spoken;
}

function matchIp(core, lang) {
  const m = core.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  if (m.slice(1).some((p) => Number(p) > 255)) return null;
  const t = T[L(lang)];
  return m.slice(1).map((p) => intToWords(p, lang)).join(` ${t.dot} `);
}

function matchPhone(core, lang) {
  const digits = core.replace(/[^\d]/g, '');
  const shaped = /^\+?\d{0,3}[-. ]?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/.test(core);
  if (!shaped || digits.length < 10 || digits.length > 13) return null;
  if (!/[-.()]/.test(core) && !core.startsWith('+') && digits.length !== 10) return null;
  const groups = [];
  let rest = digits;
  if (rest.length > 10) { groups.push(rest.slice(0, rest.length - 10)); rest = rest.slice(-10); }
  groups.push(rest.slice(0, 3), rest.slice(3, 6), rest.slice(6));
  // Commas give the engine a beat between groups, the way a person dictates.
  return groups.filter(Boolean).map((g) => spellDigits(g, lang)).join(', ');
}

function matchFraction(core, lang) {
  const m = core.match(/^(\d{1,3})\/(\d{1,3})$/);
  if (!m) return null;
  const num = Number(m[1]), den = Number(m[2]);
  if (!den) return null;
  const t = T[L(lang)];
  if (lang === 'fr') {
    const names = { 2: ['demi', 'demis'], 3: ['tiers', 'tiers'], 4: ['quart', 'quarts'] };
    const n = names[den];
    if (n) return `${intToWords(m[1], 'fr')} ${pick(n, num)}`;
    return `${intToWords(m[1], 'fr')} ${t.over} ${intToWords(m[2], 'fr')}`;
  }
  const names = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'],
                  5: ['fifth', 'fifths'], 8: ['eighth', 'eighths'], 10: ['tenth', 'tenths'] };
  const n = names[den];
  if (n) return `${intToWords(m[1], 'en')} ${pick(n, num)}`;
  return `${intToWords(m[1], 'en')} ${t.over} ${intToWords(m[2], 'en')}`;
}

function matchOrdinal(core, lang) {
  const en = core.match(/^(\d+)(st|nd|rd|th)$/i);
  if (en) return ordinalToWords(Number(en[1]), 'en');
  if (lang === 'fr') {
    const fr = core.match(/^(\d+)(ers?|res?|ères?|èmes?|ièmes?|es?|ᵉ|ᵈ)$/);
    if (fr) return ordinalToWords(Number(fr[1]), 'fr', /^(re|res|ère|ères)$/.test(fr[2]));
  }
  return null;
}

function matchPercent(core, lang) {
  const m = core.match(new RegExp(`^([+\\-−]?(?:${NUM_RE}))\\s*([%‰])$`));
  if (!m) return null;
  const n = parseNumber(m[1], lang);
  if (!n) return null;
  return `${sayNumber(n, lang)} ${SYMBOLS[m[2]][L(lang)]}`;
}

function matchCurrencyToken(core, lang) {
  // $1,234.56 · €2.4M · 1 234,56 $ · CAD 40 · 40$
  const pre = core.match(new RegExp(
    `^(${CUR_ANY})\\s*([+\\-−]?(?:${NUM_RE}))(${SCALE_KEYS})?$`
  ));
  if (pre && currencyNames(pre[1], lang)) return sayMoney(pre[1], pre[2], pre[3], lang);

  const post = core.match(new RegExp(
    `^([+\\-−]?(?:${NUM_RE}))(${SCALE_KEYS})?\\s*(${CUR_ANY})$`
  ));
  if (post && currencyNames(post[3], lang)) return sayMoney(post[3], post[1], post[2], lang);

  return null;
}

function matchScaled(core, lang) {
  const m = core.match(new RegExp(`^([+\\-−]?(?:${NUM_RE}))(${SCALE_KEYS})$`));
  if (!m) return null;
  const n = parseNumber(m[1], lang);
  if (!n) return null;
  const scale = scaleWord(m[2], lang, n.value);
  return scale ? `${sayNumber(n, lang)} ${scale}` : null;
}

function matchUnit(core, lang) {
  const keys = Object.keys(UNITS).sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  const m = core.match(new RegExp(`^([+\\-−]?(?:${NUM_RE}))\\s*(${keys})$`));
  if (!m) return null;
  const n = parseNumber(m[1], lang);
  if (!n) return null;
  const names = UNITS[m[2]][L(lang)];
  return `${sayNumber(n, lang)} ${pick(names, n.value)}`;
}

function matchRange(core, lang) {
  const t = T[L(lang)];
  const m = core.match(new RegExp(
    `^((?:${CUR_ANY})?)\\s*(${NUM_RE})\\s*[-–—]\\s*((?:${CUR_ANY})?)\\s*(${NUM_RE})\\s*([%‰])?$`
  ));
  if (!m) return null;
  const [, curA, a, curB, b, pct] = m;
  const nA = parseNumber(a, lang);
  const nB = parseNumber(b, lang);
  if (!nA || !nB) return null;

  // A pair of bare four-digit numbers inside the year range reads as years.
  const yearish = !curA && !curB && !pct && !nA.frac && !nB.frac &&
    /^\d{4}$/.test(nA.int) && /^\d{4}$/.test(nB.int) &&
    Number(nA.int) >= 1000 && Number(nB.int) <= 2199 && Number(nB.int) >= Number(nA.int);
  if (yearish) return `${yearToWords(nA.int, lang)} ${t.to} ${yearToWords(nB.int, lang)}`;

  const left = curA ? sayMoney(curA, a, null, lang) : sayNumber(nA, lang);
  const rightCur = curB || curA;
  const right = rightCur ? sayMoney(rightCur, b, null, lang) : sayNumber(nB, lang);
  if (!left || !right) return null;
  return `${left} ${t.to} ${right}${pct ? ` ${SYMBOLS[pct][L(lang)]}` : ''}`;
}

function matchYear(core, lang, prevLc) {
  if (!/^\d{4}$/.test(core)) return null;
  const n = Number(core);
  if (n < 1000 || n > 2199) return null;
  if (!prevLc || !YEAR_CUES.has(prevLc.replace(TRAIL_PUNCT, '').toLowerCase())) return null;
  return yearToWords(n, lang);
}

function matchPlainNumber(core, lang, prevLc) {
  const n = parseNumber(core, lang);
  if (!n) return null;
  // A long unbroken digit run is an identifier, not a quantity.
  if (!n.frac && n.int.length >= 10) return spellDigits(n.int, lang);
  if (!n.frac && n.int.length >= 5 && !/[.,\s]/.test(core) &&
      prevLc && SERIAL_CUES.has(prevLc.replace(/[^\w°º#]/g, '').toLowerCase())) {
    return spellDigits(n.int, lang);
  }
  return sayNumber(n, lang);
}

const NUM_SIGN = /^(?:#|№|[Nn][ºo°]\.?)/;

function matchNumberSign(core, lang, next) {
  if (!NUM_SIGN.test(core)) return null;
  const word = SYMBOLS['#'][L(lang)];
  const rest = core.replace(NUM_SIGN, '').trim();

  // A bare "#" / "No." standing before the number it labels.
  if (!rest) return next && /^[\dA-Z]/.test(next) ? word : null;

  const n = parseNumber(rest, lang);
  if (n) {
    // Past four places a reference number is read digit by digit.
    const body = n.int.length >= 5 && !n.frac ? spellDigits(n.int, lang) : sayNumber(n, lang);
    return `${word} ${body}`;
  }
  if (looksLikeSerial(rest)) return `${word} ${saySerial(rest, lang)}`;
  return null;
}

function matchSymbolOnly(core, lang) {
  if (core.length > 2) return null;
  const sym = SYMBOLS[core];
  return sym ? sym[L(lang)] : null;
}

function matchAbbreviation(core, lang) {
  const table = ABBREVIATIONS[L(lang)];
  const key = core.toLowerCase().replace(/\.$/, '');
  return table[key] || null;
}

function matchAcronym(core) {
  // All-caps, vowel-free runs are said letter by letter: PDF, HTML, SQL.
  if (!/^[A-Z]{2,6}$/.test(core)) return null;
  if (VOWELS.test(core)) return null;
  return core.split('').join(' ');
}

/* ── Token driver ────────────────────────────────────────────────────── */

const MATCHERS = [
  ['url', (c, lang) => matchUrlOrEmail(c, lang)],
  ['time', (c, lang, ctx) => matchTime(c, lang, ctx.next)],
  ['date', (c, lang) => matchIsoDate(c, lang)],
  ['date', (c, lang) => matchSlashDate(c, lang)],
  ['ip', (c, lang) => matchIp(c, lang)],
  ['version', (c, lang) => matchVersion(c, lang)],
  ['phone', (c, lang) => matchPhone(c, lang)],
  ['numsign', (c, lang, ctx) => matchNumberSign(c, lang, ctx.next)],
  ['range', (c, lang) => matchRange(c, lang)],
  ['money', (c, lang) => matchCurrencyToken(c, lang)],
  ['percent', (c, lang) => matchPercent(c, lang)],
  ['fraction', (c, lang) => matchFraction(c, lang)],
  ['ordinal', (c, lang) => matchOrdinal(c, lang)],
  ['unit', (c, lang) => matchUnit(c, lang)],
  ['scaled', (c, lang) => matchScaled(c, lang)],
  ['year', (c, lang, ctx) => matchYear(c, lang, ctx.prevLc)],
  ['number', (c, lang, ctx) => matchPlainNumber(c, lang, ctx.prevLc)],
  ['serial', (c, lang) => (looksLikeSerial(c) ? saySerial(c, lang) : null)],
  ['mixed', (c, lang) => (/[A-Za-zÀ-ÿ]/.test(c) && /\d/.test(c) ? sayMixedWord(c, lang) : null)],
  ['symbol', (c, lang) => matchSymbolOnly(c, lang)],
  ['abbrev', (c, lang) => matchAbbreviation(c, lang)],
  ['acronym', (c) => matchAcronym(c)],
];

/**
 * Verbalize one whitespace-delimited token.
 * Returns `{ spoken, kind, consumed }`; `kind` is null when nothing changed.
 */
export function verbalizeToken(raw, lang = 'en', ctx = {}) {
  // Matchers compare against the bare code, so normalise before dispatching.
  const code = L(lang);
  const { lead, core, trail } = peel(raw);
  if (!core) return { spoken: raw, kind: null, consumed: 0 };

  for (const [kind, fn] of MATCHERS) {
    let spoken;
    try { spoken = fn(core, code, ctx); } catch { spoken = null; }
    if (spoken != null && spoken !== core) {
      // A trailing currency symbol or "%" written apart belongs to this token.
      let consumed = 0;
      if (kind === 'time' && ctx.next && /^[ap]\.?m\.?[.,;:!?]?$/i.test(ctx.next)) consumed = 1;
      // "No." and "etc." own their period; keep it from doubling as a full stop.
      const tail = (kind === 'abbrev' || kind === 'numsign') ? trail.replace(/^\./, '') : trail;
      return { spoken: lead + spoken + tail, kind, consumed, from: core, to: spoken };
    }
  }
  return { spoken: raw, kind: null, consumed: 0 };
}

/** Pre-join tokens that a writer split with a space: "1 234,56 $", "40 %". */
function stitch(tokens) {
  const out = [];
  const groupRe = /^\d{3}(?:[.,]\d+)?$/;
  const trailCurRe = new RegExp(`^(?:${CUR_SYM}|${CUR_CODE})[.,;:!?]?$`);
  const scaleCurRe = new RegExp(`^(?:${SCALE_KEYS})(?:${CUR_SYM})[.,;:!?]?$`);
  // Only units that cannot double as an ordinary word are joined across a space.
  const unitRe = new RegExp(`^(?:${SAFE_UNIT_KEYS})[.,;:!?]?$`);

  for (let i = 0; i < tokens.length; i++) {
    let text = tokens[i];
    let span = 1;
    // French-style thousands grouping written with spaces.
    while (
      i + span < tokens.length &&
      /\d$/.test(text.replace(TRAIL_PUNCT, '')) &&
      groupRe.test(tokens[i + span])
    ) {
      text += ` ${tokens[i + span]}`;
      span++;
    }
    // A currency mark or percent sign standing on its own after the amount.
    if (i + span < tokens.length && /\d$/.test(text.replace(TRAIL_PUNCT, ''))) {
      const nxt = tokens[i + span];
      if (trailCurRe.test(nxt) || scaleCurRe.test(nxt) || unitRe.test(nxt) || /^[%‰][.,;:!?]?$/.test(nxt)) {
        text += nxt;
        span++;
      }
    }
    // A currency code or symbol standing on its own before the amount.
    if (span === 1 && (CUR_CODE_RE.test(text) || new RegExp(`^(?:${CUR_SYM})$`).test(text)) &&
        i + 1 < tokens.length && /^[+\-−]?\d/.test(tokens[i + 1])) {
      text += tokens[i + 1];
      span = 2;
    }
    out.push({ text, span });
    i += span - 1;
  }
  return out;
}

/**
 * Verbalize a whole sentence.
 * Returns `{ spoken, changes }` — `changes` lists what was rewritten, which the
 * UI uses to show the reader how each notation was read.
 */
export function verbalizeSentence(sentence, lang = 'en') {
  if (!sentence || !sentence.trim()) return { spoken: sentence, changes: [] };
  // Outside English and French there is no word list to read numbers into, and
  // English words in a German voice would be worse than the numerals. Pass through.
  if (!SUPPORTED.has(String(lang || 'en').slice(0, 2).toLowerCase())) {
    return { spoken: sentence, changes: [] };
  }
  const code = L(lang);

  const rawTokens = sentence.split(/(\s+)/);
  const words = [];
  const layout = [];
  for (const piece of rawTokens) {
    if (/^\s*$/.test(piece)) layout.push({ ws: piece });
    else { layout.push({ idx: words.length }); words.push(piece); }
  }

  const groups = stitch(words);
  const spokenByWord = new Array(words.length).fill(null);
  const changes = [];

  let w = 0;
  for (let g = 0; g < groups.length; g++) {
    const { text, span } = groups[g];
    const nextGroup = groups[g + 1];
    const prevGroup = groups[g - 1];
    const ctx = {
      next: nextGroup ? nextGroup.text : null,
      prevLc: prevGroup ? prevGroup.text.toLowerCase() : null,
    };
    const { spoken, kind, consumed, from, to } = verbalizeToken(text, code, ctx);

    spokenByWord[w] = spoken;
    for (let k = 1; k < span; k++) spokenByWord[w + k] = '';
    if (kind) changes.push({ from: from.replace(/\u00A0/g, ' '), to, kind });

    w += span;
    if (consumed) {
      for (let c = 0; c < consumed && g + 1 < groups.length; c++) {
        g++;
        for (let k = 0; k < groups[g].span; k++) spokenByWord[w + k] = '';
        w += groups[g].span;
      }
    }
  }

  const spoken = layout
    .map((part) => (part.ws !== undefined ? part.ws : spokenByWord[part.idx] ?? words[part.idx]))
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { spoken, changes };
}

/** Convenience wrapper used by the tests and the preview panel. */
export function verbalizeText(text, lang = 'en') {
  return text.split(/\n/).map((line) => verbalizeSentence(line, lang).spoken).join('\n');
}
