/**
 * zip.js — the minimum ZIP reader needed to open .docx and .epub in the
 * browser, using the platform's own DecompressionStream. No dependency.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a ZIP archive into `{ name → Uint8Array }`.
 * `filter` limits which entries are decompressed — a .docx only needs one file.
 */
export async function readZip(buffer, filter = () => true) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-central-directory record sits in the last 64KB, after a
  // variable-length comment, so it has to be scanned for backwards.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP archive');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== CD_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!filter(name)) continue;
    // A ZIP64 sentinel (0xFFFFFFFF) or a truncated archive would send
    // getUint32 past the end of the buffer and throw.
    if (localOffset + 30 > bytes.length) continue;
    if (view.getUint32(localOffset, true) !== LFH_SIG) continue;

    // Local-header lengths differ from the central directory's; read them here.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = await inflateRaw(raw);
    // Any other method (bzip2, lzma) is vanishingly rare in documents.
  }

  return out;
}
