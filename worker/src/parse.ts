/** Edge file text extraction (.txt / .md / .docx / .pdf). */

import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_PARSE_BYTES = 12 * 1024 * 1024;

export class ParseError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, ent) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[ent] ?? whole;
  });
}

/** Minimal OOXML text extraction: word/document.xml, paragraph-joined. */
function extractDocxText(bytes: Uint8Array): string {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new ParseError(415, "Could not read .docx: not a valid zip archive.");
  }
  const entry = zip["word/document.xml"];
  if (!entry) {
    throw new ParseError(415, "Could not find word/document.xml inside the .docx file.");
  }
  const xml = strFromU8(entry);
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map((p) => {
    const runs = p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
    return runs
      .map((r) => decodeXmlEntities(r.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "")))
      .join("");
  });
  return lines.filter((l) => l.length).join("\n");
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let doc;
  try {
    doc = await getDocumentProxy(bytes);
  } catch (e) {
    const message = String((e as Error)?.message || e).slice(0, 160);
    throw new ParseError(415, `Could not read .pdf: ${message}`);
  }
  const { text } = await extractText(doc, { mergePages: true });
  if (!text || !text.trim()) {
    throw new ParseError(415, "No extractable text found in this .pdf (it may be scanned/image-only).");
  }
  return text;
}

export interface ParsedFile {
  text: string;
  word_count: number;
  char_count: number;
}

export async function parseUploadedFile(bytes: Uint8Array, filename: string): Promise<ParsedFile> {
  const name = (filename || "").toLowerCase();

  let text: string;
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    text = new TextDecoder("utf-8").decode(bytes);
  } else if (name.endsWith(".docx")) {
    text = extractDocxText(bytes);
  } else if (name.endsWith(".pdf")) {
    text = await extractPdfText(bytes);
  } else {
    throw new ParseError(415, "Unsupported file type. Use .txt, .md, .docx, or .pdf.");
  }

  text = text.trim();
  const word_count = (text.match(/\S+/g) || []).length;
  return { text, word_count, char_count: text.length };
}
