/** Client-side file text extraction. */
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  SUPPORTED_EXTENSIONS,
  TEXT_EXTENSIONS,
  DOCX_EXTENSIONS,
  PDF_EXTENSIONS,
} from './config.js';
import { extensionFromFilename, normalizeText } from './text.js';

export async function extractDocxText(file) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeText(result.value);
}

export async function extractPdfText(file, reportProgress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const documentProxy = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      pages.push(pageText);
    }

    if (typeof reportProgress === 'function') {
      reportProgress(pageNumber, documentProxy.numPages);
    }
  }

  return normalizeText(pages.join('\n\n'));
}

export async function extractTextFromFile(file, setStatus) {
  const ext = extensionFromFilename(file.name);

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported file type. Supported: .txt, .md, .docx, .pdf');
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return normalizeText(await file.text());
  }

  if (DOCX_EXTENSIONS.has(ext)) {
    setStatus('Extracting text from DOCX...', 'info');
    return extractDocxText(file);
  }

  if (PDF_EXTENSIONS.has(ext)) {
    setStatus('Extracting text from PDF...', 'info');
    return extractPdfText(file, (current, total) => {
      setStatus(`Extracting PDF text (page ${current}/${total})...`, 'info');
    });
  }

  throw new Error('Unsupported file type.');
}

