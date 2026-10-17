/**
 * numbers.js — integer/decimal → spoken words, English and French.
 *
 * String-based (not Number-based) so arbitrarily long digit runs survive
 * without float rounding. Everything here is pure and side-effect free so the
 * node test suite can exercise it directly.
 */

/* ── English ─────────────────────────────────────────────────────────── */

const EN_SMALL = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = [
  '', 'thousand', 'million', 'billion', 'trillion', 'quadrillion',
  'quintillion', 'sextillion', 'septillion', 'octillion',
];

function enChunk(n) {
  const out = [];
  if (n >= 100) {
    out.push(EN_SMALL[Math.floor(n / 100)], 'hundred');
    n %= 100;
  }
  if (n >= 20) {
    const tens = EN_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    out.push(ones ? `${tens}-${EN_SMALL[ones]}` : tens);
  } else if (n > 0) {
    out.push(EN_SMALL[n]);
  }
  return out.join(' ');
}

/* ── French ──────────────────────────────────────────────────────────── */

const FR_SMALL = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];
// 70 and 90 build on soixante / quatre-vingt, so they share those stems.
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
const FR_SCALES = ['', 'mille', 'million', 'milliard', 'billion', 'billiard', 'trillion', 'trilliard'];

function frTens(n) {
  if (n < 20) return FR_SMALL[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (t === 7 || t === 9) {
    // soixante-dix…soixante-dix-neuf, quatre-vingt-dix…quatre-vingt-dix-neuf
    const rest = FR_SMALL[10 + o];
    if (t === 7 && o === 1) return 'soixante et onze';
    return `${FR_TENS[t]}-${rest}`;
  }
  if (t === 8) return o === 0 ? 'quatre-vingts' : `quatre-vingt-${FR_SMALL[o]}`;
  if (o === 0) return FR_TENS[t];
  if (o === 1) return `${FR_TENS[t]} et un`;
  return `${FR_TENS[t]}-${FR_SMALL[o]}`;
}

// `plainHundreds` marks a group whose "cent" may take the plural -s: only when
// the group ends the number (deux cents) and is not multiplying mille.
function frChunk(n, allowCentsPlural) {
  const out = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) {
    if (h === 1) out.push('cent');
    else out.push(`${FR_SMALL[h]} cent${rest === 0 && allowCentsPlural ? 's' : ''}`);
  }
  if (rest > 0) out.push(frTens(rest));
  return out.join(' ');
}

/* ── Shared driver ───────────────────────────────────────────────────── */

function groupsOf3(digits) {
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) {
    groups.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return groups;
}

/**
 * Spell a run of digits one at a time — the readback form used for serials,
 * account numbers, phone numbers and anything longer than a scale word covers.
 */
export function spellDigits(digits, lang = 'en') {
  const table = lang === 'fr' ? FR_SMALL : EN_SMALL;
  return digits.split('').map((d) => (/\d/.test(d) ? table[Number(d)] : d)).join(' ');
}

/** Integer digit-string → words. Returns null when out of practical range. */
export function intToWords(digits, lang = 'en') {
  const clean = String(digits).replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(clean)) return null;
  if (clean === '0') return lang === 'fr' ? 'zéro' : 'zero';

  const groups = groupsOf3(clean);
  const maxScales = lang === 'fr' ? FR_SCALES.length : EN_SCALES.length;
  if (groups.length > maxScales) return spellDigits(clean, lang);

  const scales = lang === 'fr' ? FR_SCALES : EN_SCALES;
  const parts = [];

  groups.forEach((g, i) => {
    const v = Number(g);
    if (!v) return;
    const scaleIdx = groups.length - 1 - i;
    const scale = scales[scaleIdx];

    if (lang === 'fr') {
      // "mille" is invariable and drops its "un"; million/milliard pluralise.
      const isMille = scaleIdx === 1;
      const body = frChunk(v, !isMille);
      if (isMille) {
        parts.push(v === 1 ? 'mille' : `${body} mille`);
      } else if (scaleIdx === 0) {
        parts.push(body);
      } else {
        parts.push(`${body} ${scale}${v > 1 ? 's' : ''}`);
      }
    } else {
      parts.push(scale ? `${enChunk(v)} ${scale}` : enChunk(v));
    }
  });

  return parts.join(' ');
}

/**
 * Decimal → words. `pairCents` reads a two-digit fraction as a whole number
 * (money: "fifty-six cents"); otherwise digits are read singly ("point one four").
 */
export function decimalToWords(intPart, fracPart, lang = 'en', pairCents = false) {
  const whole = intToWords(intPart || '0', lang);
  if (!fracPart) return whole;
  if (pairCents && fracPart.length <= 2) {
    const padded = fracPart.length === 1 ? `${fracPart}0` : fracPart;
    return { whole, frac: intToWords(padded, lang), paired: true };
  }
  const point = lang === 'fr' ? 'virgule' : 'point';
  return `${whole} ${point} ${spellDigits(fracPart, lang)}`;
}

/* ── Ordinals ────────────────────────────────────────────────────────── */

const EN_ORDINAL_IRREGULAR = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

export function ordinalToWords(n, lang = 'en', feminine = false) {
  const cardinal = intToWords(String(n), lang);
  if (!cardinal) return null;

  if (lang === 'fr') {
    if (Number(n) === 1) return feminine ? 'première' : 'premier';
    let base = cardinal;
    if (/\bcinq$/.test(base)) base = base.replace(/cinq$/, 'cinqu');
    else if (/\bneuf$/.test(base)) base = base.replace(/neuf$/, 'neuv');
    // "cent" and "vingt" are the only cardinals that take a plural -s, and it
    // drops before the suffix: quatre-vingts → quatre-vingtième. Stripping any
    // trailing -s would break trois, which keeps it.
    else base = base.replace(/(cent|vingt)s$/, '$1').replace(/e$/, '');
    return `${base}ième`;
  }

  // Only the final word inflects: "twenty-first", "one hundred third".
  const parts = cardinal.split(/([ -])/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const w = parts[i];
    if (!w || w === ' ' || w === '-') continue;
    if (EN_ORDINAL_IRREGULAR[w]) parts[i] = EN_ORDINAL_IRREGULAR[w];
    else if (w.endsWith('y')) parts[i] = `${w.slice(0, -1)}ieth`;
    else parts[i] = `${w}th`;
    break;
  }
  return parts.join('');
}

/* ── Years ───────────────────────────────────────────────────────────── */

/**
 * Read a 4-digit year the way a person does: 1998 → "nineteen ninety-eight",
 * 2005 → "two thousand five", 2026 → "twenty twenty-six". French reads years
 * as plain cardinals, so it falls through to intToWords.
 */
export function yearToWords(year, lang = 'en') {
  const n = Number(year);
  if (!Number.isInteger(n)) return null;
  if (lang === 'fr') return intToWords(String(n), lang);
  if (n < 1000 || n > 9999) return intToWords(String(n), lang);

  const hi = Math.floor(n / 100);
  const lo = n % 100;
  // Round thousands stay cardinal: 2000 → "two thousand", never "twenty hundred".
  if (n % 1000 === 0) return intToWords(String(n), lang);
  if (lo === 0) return `${enChunk(hi)} hundred`;
  // 2005 → "two thousand five"; 1905 → "nineteen oh five".
  if (lo < 10) {
    return hi % 10 === 0 ? intToWords(String(n), lang) : `${enChunk(hi)} oh ${EN_SMALL[lo]}`;
  }
  return `${enChunk(hi)} ${enChunk(lo)}`;
}

export const SMALL_WORDS = { en: EN_SMALL, fr: FR_SMALL };
