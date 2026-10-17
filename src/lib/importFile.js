/**
 * importFile.js — pull readable text out of whatever the reader drops in.
 * Everything runs in the browser: nothing is uploaded anywhere.
 */

import { readZip } from './zip';

export const ACCEPTED = '.txt,.md,.markdown,.csv,.json,.log,.rtf,.html,.htm,.xml,.docx,.epub,.pdf';

/** Documents beyond this are refused rather than freezing the tab. */
export const MAX_BYTES = 25 * 1024 * 1024;

const decoder = new TextDecoder();

function tidy(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '')          // soft hyphens, common in PDF exports
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg').forEach((el) => el.remove());
  // Give block elements a line break so paragraphs survive text flattening.
  doc.querySelectorAll('p,div,br,li,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach((el) => el.append('\n'));
  return tidy(doc.body?.textContent || '');
}

function fromRtf(rtf) {
  return tidy(
    rtf
      .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\[a-z]+-?\d*\s?/gi, '')
      .replace(/[{}]/g, ''),
  );
}

/** Word stores its text in word/document.xml; paragraphs are <w:p> elements. */
function fromDocxXml(xml) {
  return tidy(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'),
  );
}

async function fromDocx(buffer) {
  const files = await readZip(buffer, (n) => n === 'word/document.xml');
  const main = files['word/document.xml'];
  if (!main) throw new Error('This .docx has no readable document body.');
  return fromDocxXml(decoder.decode(main));
}

async function fromEpub(buffer) {
  const files = await readZip(buffer, (n) => /\.x?html?$/i.test(n) && !/nav|toc|cover/i.test(n));
  const names = Object.keys(files).sort();
  if (!names.length) throw new Error('This .epub has no readable chapters.');
  return tidy(names.map((n) => fromHtml(decoder.decode(files[n]))).join('\n\n'));
}

async function fromPdf(buffer, onProgress) {
  // pdf.js is ~1 MB, so it only loads when a PDF is actually opened.
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(i, doc.numPages);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild line breaks from the layout: pdf.js marks end-of-line items.
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (item.str) line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  // Words split across a line break by hyphenation are rejoined.
  return tidy(pages.join('\n\n').replace(/(\w)-\n(\w)/g, '$1$2'));
}

/**
 * Extract text from a File. `onProgress(done, total)` reports PDF page work.
 * Throws with a reader-facing message on unsupported or damaged input.
 */
export async function extractText(file, onProgress) {
  if (file.size > MAX_BYTES) {
    throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_BYTES / 1048576} MB.`);
  }
  const name = file.name.toLowerCase();
  // lastIndexOf returns -1 with no dot, and slice(-1) would take the last
  // character: "README" must yield no extension, not ".e".
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';

  if (['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.xml'].includes(ext)) {
    return tidy(await file.text());
  }
  if (ext === '.rtf') return fromRtf(await file.text());
  if (ext === '.html' || ext === '.htm') return fromHtml(await file.text());

  const buffer = await file.arrayBuffer();
  if (ext === '.docx') return fromDocx(buffer);
  if (ext === '.epub') return fromEpub(buffer);
  if (ext === '.pdf') return fromPdf(buffer, onProgress);

  if (ext === '.doc') throw new Error('Legacy .doc is not readable in the browser. Save it as .docx or PDF.');

  // Unknown extension: read it as text if it decodes cleanly.
  const text = tidy(decoder.decode(buffer));
  const looksBinary = /[\u0000-\u0008\u000E-\u001F\uFFFD]/.test(text.slice(0, 2000));
  if (text && !looksBinary) return text;
  throw new Error(`ECHO cannot read ${ext || 'this file type'} yet.`);
}
