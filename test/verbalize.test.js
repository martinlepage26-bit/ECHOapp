import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verbalizeSentence, parseNumber, looksLikeSerial } from '../src/lib/verbalize.js';
import { intToWords, yearToWords, ordinalToWords } from '../src/lib/numbers.js';

const say = (s, lang = 'en') => verbalizeSentence(s, lang).spoken;

/* ── numbers ─────────────────────────────────────────────────────────── */

test('cardinals', () => {
  assert.equal(intToWords('0'), 'zero');
  assert.equal(intToWords('19'), 'nineteen');
  assert.equal(intToWords('101'), 'one hundred one');
  assert.equal(intToWords('1234567'), 'one million two hundred thirty-four thousand five hundred sixty-seven');
  assert.equal(intToWords('1000000000000'), 'one trillion');
});

test('French cardinals follow French agreement rules', () => {
  assert.equal(intToWords('71', 'fr'), 'soixante et onze');
  assert.equal(intToWords('80', 'fr'), 'quatre-vingts');
  assert.equal(intToWords('81', 'fr'), 'quatre-vingt-un');
  assert.equal(intToWords('91', 'fr'), 'quatre-vingt-onze');
  assert.equal(intToWords('200', 'fr'), 'deux cents');
  assert.equal(intToWords('200000', 'fr'), 'deux cent mille');
  assert.equal(intToWords('1000', 'fr'), 'mille');
});

test('years read the way people say them', () => {
  assert.equal(yearToWords(1066), 'ten sixty-six');
  assert.equal(yearToWords(1900), 'nineteen hundred');
  assert.equal(yearToWords(1905), 'nineteen oh five');
  assert.equal(yearToWords(2000), 'two thousand');
  assert.equal(yearToWords(2005), 'two thousand five');
  assert.equal(yearToWords(2026), 'twenty twenty-six');
});

test('ordinals', () => {
  assert.equal(ordinalToWords(1), 'first');
  assert.equal(ordinalToWords(12), 'twelfth');
  assert.equal(ordinalToWords(21), 'twenty-first');
  assert.equal(ordinalToWords(40), 'fortieth');
  assert.equal(ordinalToWords(1, 'fr'), 'premier');
  assert.equal(ordinalToWords(1, 'fr', true), 'première');
  assert.equal(ordinalToWords(5, 'fr'), 'cinquième');
  assert.equal(ordinalToWords(9, 'fr'), 'neuvième');
});

/* ── separators ──────────────────────────────────────────────────────── */

test('thousands and decimal marks resolve against the language', () => {
  assert.deepEqual(parseNumber('1,234', 'en'), { sign: '', int: '1234', frac: '', value: 1234 });
  assert.equal(parseNumber('1.234', 'en').frac, '234');   // English: decimal
  assert.equal(parseNumber('1.234', 'fr').frac, '');      // French: thousands
  assert.equal(parseNumber('1,234', 'fr').frac, '234');
  assert.equal(parseNumber('1.234,56', 'fr').int, '1234');
  assert.equal(parseNumber('1,234,567', 'en').int, '1234567');
  assert.equal(parseNumber('1 234 567', 'fr').int, '1234567');
  assert.equal(parseNumber('hello', 'en'), null);
});

/* ── money ───────────────────────────────────────────────────────────── */

test('amounts of money', () => {
  assert.equal(say('$1,234.56'), 'one thousand two hundred thirty-four dollars and fifty-six cents');
  assert.equal(say('$1.00'), 'one dollar');
  assert.equal(say('$0.99'), 'ninety-nine cents');
  assert.equal(say('$2.4M'), 'two point four million dollars');
  assert.equal(say('€50'), 'fifty euros');
  assert.equal(say('£3.50'), 'three pounds and fifty pence');
  assert.equal(say('CAD 40'), 'forty Canadian dollars');
  assert.equal(say('USD 1,000'), 'one thousand US dollars');
  assert.equal(say('40$'), 'forty dollars');
});

test('French amounts', () => {
  assert.equal(say('1 234,56 $', 'fr'), 'mille deux cent trente-quatre dollars et cinquante-six cents');
  assert.equal(say('2,5 M$', 'fr'), 'deux virgule cinq millions de dollars');
  assert.equal(say('12 000 $', 'fr'), 'douze mille dollars');
  assert.equal(say('45 %', 'fr'), 'quarante-cinq pour cent');
});

/* ── ranges: "numbers between amounts" ───────────────────────────────── */

test('ranges between amounts', () => {
  assert.equal(say('$5-$10'), 'five dollars to ten dollars');
  assert.equal(say('10-20%'), 'ten to twenty percent');
  assert.equal(say('2020-2024'), 'twenty twenty to twenty twenty-four');
  assert.equal(say('pp. 33–47'), 'pages thirty-three to forty-seven');
});

/* ── serial numbers ──────────────────────────────────────────────────── */

test('serial numbers are spelled for readback', () => {
  assert.equal(say('A4-9920-XJ'), 'A four dash nine nine two zero dash X J');
  assert.equal(say('SN12345'), 'S N one two three four five');
  assert.equal(say('#INV-2026-0042'), 'number I N V dash two zero two six dash zero zero four two');
  assert.equal(say('Order No. 8891233'), 'Order number eight eight nine one two three three');
  assert.equal(say('12345678901'), 'one two three four five six seven eight nine zero one');
});

test('word-shaped codes are not spelled out', () => {
  assert.equal(say('COVID-19'), 'COVID nineteen');
  assert.equal(say('iPhone15'), 'iPhone fifteen');
  assert.ok(!looksLikeSerial('COVID-19'));
  assert.ok(looksLikeSerial('A4-9920-XJ'));
  assert.ok(looksLikeSerial('MP3'));
});

/* ── dates, times, structured identifiers ────────────────────────────── */

test('dates', () => {
  assert.equal(say('2026-09-02'), 'September second, twenty twenty-six');
  assert.equal(say('09/02/2026'), 'September second, twenty twenty-six');
  assert.equal(say('25/12/2026'), 'December twenty-fifth, twenty twenty-six');
  assert.equal(say('2026-09-02', 'fr'), 'deux septembre deux mille vingt-six');
});

test('times', () => {
  assert.equal(say('14:30'), 'fourteen thirty');
  assert.equal(say('9:05'), 'nine oh five');
  assert.equal(say('3:00'), "three o'clock");
  assert.equal(say('3:45 PM'), 'three forty-five P M');
});

test('versions, addresses and phone numbers', () => {
  assert.equal(say('v2.1.0'), 'version two point one point zero');
  assert.equal(say('192.168.1.1'), 'one hundred ninety-two dot one hundred sixty-eight dot one dot one');
  assert.equal(say('514-555-0123'), 'five one four, five five five, zero one two three');
  assert.equal(say('ml@pharos-ai.ca'), 'M L at pharos dash A I dot C A');
});

/* ── units, fractions, symbols ───────────────────────────────────────── */

test('units and fractions', () => {
  assert.equal(say('5kg'), 'five kilograms');
  assert.equal(say('1kg'), 'one kilogram');
  assert.equal(say('1.5GB'), 'one point five gigabytes');
  assert.equal(say('3/4'), 'three quarters');
  assert.equal(say('1/2'), 'one half');
  assert.equal(say('7/16'), 'seven over sixteen');
  assert.equal(say('5 kg', 'fr'), 'cinq kilogrammes');
});

test('signs and percentages', () => {
  assert.equal(say('-15'), 'minus fifteen');
  assert.equal(say('45%'), 'forty-five percent');
  assert.equal(say('0.5%'), 'zero point five percent');
});

/* ── restraint ───────────────────────────────────────────────────────── */

test('ordinary prose is left alone', () => {
  const prose = 'The art of reading is, in many respects, the art of listening.';
  assert.equal(say(prose), prose);
  assert.equal(say('5 in total'), 'five in total');
  assert.equal(say('a number of things'), 'a number of things');
});

test('a bare four-digit number stays a quantity without a year cue', () => {
  assert.equal(say('1500 employees'), 'one thousand five hundred employees');
  assert.equal(say('in 1998'), 'in nineteen ninety-eight');
});

test('regional tags resolve to their base language', () => {
  // The gate accepts fr-CA, so the matchers have to read it as French too.
  assert.equal(say('45 %', 'fr-CA'), 'quarante-cinq pour cent');
  assert.equal(say('1 234,56 $', 'fr-FR'), 'mille deux cent trente-quatre dollars et cinquante-six cents');
  assert.equal(say('$1.50', 'en-CA'), 'one dollar and fifty cents');
});

test('French ordinals drop only the plural that actually exists', () => {
  assert.equal(ordinalToWords(80, 'fr'), 'quatre-vingtième');
  assert.equal(ordinalToWords(200, 'fr'), 'deux centième');
  assert.equal(ordinalToWords(3, 'fr'), 'troisième');   // "trois" keeps its s
  assert.equal(ordinalToWords(6, 'fr'), 'sixième');
  assert.equal(ordinalToWords(20, 'fr'), 'vingtième');
  assert.equal(ordinalToWords(100, 'fr'), 'centième');
  assert.equal(ordinalToWords(1000, 'fr'), 'millième');
  assert.equal(ordinalToWords(71, 'fr'), 'soixante et onzième');
});

test('unsupported languages pass through untouched', () => {
  assert.equal(say('Kosten: 1.234,56 €', 'de'), 'Kosten: 1.234,56 €');
});

test('changes are reported for the reader', () => {
  const { changes } = verbalizeSentence('Wire $1,250.00 to account SN-4471 by 2026-09-30.', 'en');
  assert.deepEqual(changes.map((c) => c.kind).sort(), ['date', 'money', 'serial']);
});

/* ── a realistic passage end to end ──────────────────────────────────── */

test('mixed passage', () => {
  const src = 'Invoice #INV-2026-0042 totals $12,480.75, due 2026-09-30, covering 3 units at $4,160.25 each.';
  const out = say(src);
  assert.ok(out.includes('number I N V dash two zero two six dash zero zero four two'));
  assert.ok(out.includes('twelve thousand four hundred eighty dollars and seventy-five cents'));
  assert.ok(out.includes('September thirtieth, twenty twenty-six'));
  assert.ok(!/\d/.test(out), `digits left unspoken: ${out}`);
});
