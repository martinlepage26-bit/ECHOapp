/** Edge file text extraction (.txt/.md/.docx/.pdf). */
import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_PARSE_BYTES = 12 * 1024 * 1024;

export class ParseError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, ent) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[ent] ?? whole;
  });
}

/** Minimal OOXML text extraction: word/document.xml, paragraph-joined, mirrors python-docx's
 *  paragraph-per-line behaviour used by the Python API's _extract_docx. */
function extractDocxText(bytes) {
  let zip;
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

/** unpdf wraps a serverless build of pdf.js with no `canvas` dependency and the worker
 *  inlined, which is what makes it loadable under workerd (plain pdfjs-dist and
 *  Node-native libs like pdf-parse are not). */
async function extractPdfText(bytes) {
  let doc;
  try {
    doc = await getDocumentProxy(bytes);
  } catch (e) {
    throw new ParseError(415, `Could not read .pdf: ${String(e?.message || e).slice(0, 160)}`);
  }
  const { text } = await extractText(doc, { mergePages: true });
  if (!text || !text.trim()) {
    throw new ParseError(415, "No extractable text found in this .pdf (it may be scanned/image-only).");
  }
  return text;
}

export async function parseUploadedFile(bytes, filename) {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (name.endsWith(".docx")) {
    return extractDocxText(bytes);
  }
  if (name.endsWith(".pdf")) {
    return extractPdfText(bytes);
  }
  throw new ParseError(415, "Unsupported file type. Use .txt, .md, .docx, or .pdf.");
}

