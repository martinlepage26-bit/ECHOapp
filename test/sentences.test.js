import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, countWords } from '../src/lib/sentences.js';

const texts = (s) => splitSentences(s).map((x) => x.text);

test('splits on sentence terminators', () => {
  assert.deepEqual(texts('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
});

test('a decimal point is not a full stop', () => {
  assert.deepEqual(texts('It costs $1,234.56 today.'), ['It costs $1,234.56 today.']);
  assert.deepEqual(texts('Version 2.1.0 shipped.'), ['Version 2.1.0 shipped.']);
  assert.deepEqual(texts('Ping 192.168.1.1 first.'), ['Ping 192.168.1.1 first.']);
});

test('abbreviations and initials do not end a sentence', () => {
  assert.deepEqual(texts('Dr. Smith arrived. He left.'), ['Dr. Smith arrived.', 'He left.']);
  assert.deepEqual(texts('J. R. R. Tolkien wrote it.'), ['J. R. R. Tolkien wrote it.']);
  assert.deepEqual(texts('Use e.g. this one. Done.'), ['Use e.g. this one.', 'Done.']);
  assert.deepEqual(texts('See fig. 3 for detail.'), ['See fig. 3 for detail.']);
});

test('a trailing abbreviation can still close a sentence', () => {
  assert.deepEqual(texts('Acme Inc. The meeting starts now.'), ['Acme Inc.', 'The meeting starts now.']);
  assert.deepEqual(texts('Widgets, gears, etc. The rest follows.'), ['Widgets, gears, etc.', 'The rest follows.']);
  assert.deepEqual(texts('Smith et al. The study found more.'), ['Smith et al.', 'The study found more.']);
  // But not when the next word is an abbreviation too, or is lowercase.
  assert.deepEqual(texts('Acme Co. Ltd. was founded in 1997.'), ['Acme Co. Ltd. was founded in 1997.']);
  assert.deepEqual(texts('Inc. and Ltd. are suffixes.'), ['Inc. and Ltd. are suffixes.']);
  // Titles are always followed by a name and never close a sentence.
  assert.deepEqual(texts('Dr. Smith arrived.'), ['Dr. Smith arrived.']);
});

test('domains and file names stay whole', () => {
  assert.deepEqual(texts('Visit example.com/page now.'), ['Visit example.com/page now.']);
});

test('closing quotes belong to the sentence they close', () => {
  assert.deepEqual(texts('He said "go now." Then he left.'), ['He said "go now."', 'Then he left.']);
});

test('line breaks end sentences and blank lines mark paragraphs', () => {
  const out = splitSentences('First line\n\nSecond block. Third.');
  assert.deepEqual(out.map((s) => s.text), ['First line', 'Second block.', 'Third.']);
  assert.equal(out[1].paraBreak, 1);
  assert.equal(out[2].paraBreak, 0);
});

test('offsets point back at the source text', () => {
  const src = 'Alpha beta. Gamma delta.';
  for (const s of splitSentences(src)) {
    assert.equal(src.slice(s.start, s.end), s.text);
  }
});

test('a sentence that never terminates is broken at a soft boundary', () => {
  const runOn = Array.from({ length: 60 }, (_, i) => `item ${i}`).join(', ');
  const parts = splitSentences(runOn);
  assert.ok(parts.length > 1, 'run-on text should be broken up');
  assert.ok(parts.every((p) => p.text.length <= 400), 'no piece exceeds the utterance cap');
  assert.equal(parts.map((p) => p.text).join(' ').replace(/\s+/g, ' '), runOn.replace(/\s+/g, ' '));
});

test('offsets survive the overlong split too', () => {
  const runOn = Array.from({ length: 60 }, (_, i) => `item ${i}`).join(', ');
  for (const piece of splitSentences(runOn)) {
    assert.equal(runOn.slice(piece.start, piece.end), piece.text);
  }
});

test('index always matches the position in the returned array', () => {
  const runOn = Array.from({ length: 60 }, (_, i) => `item ${i}`).join(', ');
  const out = splitSentences(`First. ${runOn}. Last.`);
  assert.deepEqual(out.map((s) => s.index), out.map((_, i) => i));
});

test('ellipses do not each start a new sentence', () => {
  assert.deepEqual(texts('Then... it arrived. Good.'), ['Then... it arrived.', 'Good.']);
  assert.deepEqual(texts('Then... It arrived.'), ['Then...', 'It arrived.']);
});

test('word count matches a reader tally', () => {
  assert.equal(countWords('One two three'), 3);
  // "$1,234.56 / and / 45% / plus / A4-9920-XJ" — the em dash is not a word.
  assert.equal(countWords('$1,234.56 and 45% — plus A4-9920-XJ'), 5);
  assert.equal(countWords(''), 0);
});

test('ten thousand words split in well under a frame budget', () => {
  const para = 'The invoice #INV-2026-0042 totals $12,480.75, due 2026-09-30. Serial A4-9920-XJ shipped. ';
  let text = '';
  while (countWords(text) < 10000) text += para;
  const t0 = performance.now();
  const out = splitSentences(text);
  const ms = performance.now() - t0;
  assert.ok(out.length > 500, `expected many sentences, got ${out.length}`);
  assert.ok(ms < 250, `splitting 10k words took ${ms.toFixed(0)}ms`);
});
