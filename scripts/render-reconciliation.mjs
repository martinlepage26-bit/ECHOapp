import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stem = path.join(root, 'docs/reconciliation/2026-10-17');
const raw = fs.readFileSync(`${stem}.json`, 'utf8');
const data = JSON.parse(raw);
const digest = crypto.createHash('sha256').update(raw).digest('hex');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const compare = `${data.repository}/compare/main...${data.branch}`;

const markdown = `# ${data.title}

As of ${data.as_of}. Generated from [2026-10-17.json](2026-10-17.json).

The stable governed reader source was missing from GitHub. Rebuilding CT920 commit \`${data.source_commit}\` reproduced all six live files byte-for-byte. This branch restores that source, preserves its improvements over Base44, and fixes focused-button shortcuts, mobile menu clipping and Drafts dismissal.

[Review GitHub changes](${compare}) · [Base44 original](https://solid-echo-read-flow.base44.app/) · [Governed reader](https://martin.govern-ai.ca/echo/)

## Differences and decisions

| Feature | Base44 | Governed reader | Reconciliation |
| --- | --- | --- | --- |
${data.features.map((r) => `| ${[r.feature, r.base44, r.governed, r.resolution].map(cell).join(' | ')} |`).join('\n')}

## Verification

${data.verification.map((r) => `- **${r.id} — ${r.status}:** ${r.detail}`).join('\n')}

## Scope and limitations

${data.limits.map((r) => `- ${r}`).join('\n')}

## Provenance and reproducibility

- Earlier GitHub source: \`${data.previous_github_commit}\`.
- Recovered source: \`${data.source_commit}\`, tree \`${data.source_tree}\`.
- [Six-file baseline SHA-256 receipt](live-build-2026-10-17.json). The fixes change the application bundle; that receipt describes the recovered baseline, not the revised build.
- Base44 public bundle SHA-256: \`${data.base44_bundle_sha256}\`.
- Only \`src/pages/Home.jsx\` and \`src/components/ui/primitives.jsx\` differ from the recovered application source. The Worker and remaining runtime source match that stable commit.
- \`node scripts/render-reconciliation.mjs\` regenerates this page and its HTML projection. Both were rendered twice with identical hashes.
- Canonical JSON SHA-256: \`${digest}\`.

Git history retains the earlier clone/D1/API implementation. The separate website repository and unfinished CT920 working-tree changes were not modified.
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(data.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7f8;--ink:#172a31;--panel:#fff;--border:#ced9de;--accent:#08746c;--muted:#50666f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:28px 18px 64px}h1{font-size:clamp(1.7rem,5vw,2.7rem);line-height:1.15;max-width:900px}h2{font-size:1.35rem;margin-top:2rem}p{max-width:85ch}a{color:var(--accent);overflow-wrap:anywhere}a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:4px}nav{display:flex;flex-wrap:wrap;gap:10px}nav a{display:inline-block;padding:10px 14px;background:var(--panel);border:1px solid var(--border);border-radius:10px;text-decoration:none}section{margin-top:28px}.meta{font-size:.9rem;color:var(--muted)}.card{padding:18px;background:var(--panel);border:1px solid var(--border);border-radius:12px}.lead{border-left:5px solid var(--accent)}.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px}table{border-collapse:collapse;min-width:900px;width:100%;background:var(--panel);font-size:.92rem}th,td{padding:14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}th{background:var(--accent);color:white}td:first-child{font-weight:650;width:13%}.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}.checks p{margin:.4rem 0 0}.status{font-size:.78rem;font-weight:700;letter-spacing:.04em}.limit{border-left:4px solid #ad7422}.checks h3{font-size:1rem;margin:.3rem 0}code{font-size:.85em;overflow-wrap:anywhere}li{margin:.6rem 0}footer{margin-top:32px;border-top:1px solid var(--border);padding-top:18px}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(prefers-color-scheme:dark){:root{--bg:#101b20;--ink:#e8f0f2;--panel:#17282e;--border:#344b54;--accent:#65d9c3;--muted:#b2c5cc}th{color:#10201c}}@media(max-width:420px){main{padding:20px 14px 48px}.card{padding:14px}}
</style></head><body><main>
<p class="meta">ECHO · Source reconciliation · ${escape(data.as_of)}</p>
<h1>${escape(data.title)}</h1>
<div class="card lead"><strong>The live reader source is restored to a reviewable GitHub branch.</strong><p>All six files rebuilt from the recovered stable source match the governed site byte-for-byte. The reconciliation keeps the governed reader's capabilities, restores useful keyboard and mobile behavior, and adds automated checks.</p><p><strong>Delivery scope:</strong> GitHub source and pull request. Neither live website has been changed.</p></div>
<nav aria-label="Evidence links"><a href="${escape(compare)}">Review GitHub changes</a><a href="https://solid-echo-read-flow.base44.app/">Base44 original</a><a href="https://martin.govern-ai.ca/echo/">Governed reader</a></nav>
<section id="comparison"><h2>What differs and what is kept</h2><p class="meta">On small screens, scroll inside the table to compare all columns.</p><div class="table-wrap" role="region" aria-label="Feature comparison" tabindex="0"><table><thead><tr><th>Feature</th><th>Base44</th><th>Governed reader</th><th>Reconciliation</th></tr></thead><tbody>${data.features.map((r) => `<tr>${[r.feature,r.base44,r.governed,r.resolution].map((v) => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
<section id="verification"><h2>Verification and limits</h2><div class="checks">${data.verification.map((r) => `<article class="card ${r.status.startsWith('NOT_')?'limit':''}"><span class="status">${escape(r.status)}</span><h3>${escape(r.id.replaceAll('_',' '))}</h3><p>${escape(r.detail)}</p></article>`).join('')}</div></section>
<section id="scope"><h2>Scope decisions</h2><ul>${data.limits.map((r)=>`<li>${escape(r)}</li>`).join('')}</ul></section>
<section id="source"><h2>Source and preservation</h2><p>The earlier GitHub source was <code>${data.previous_github_commit}</code>. The recovered stable reader is <code>${data.source_commit}</code>. Its source tree is <code>${data.source_tree}</code>.</p><p>Only <code>src/pages/Home.jsx</code> and <code>src/components/ui/primitives.jsx</code> changed within the recovered application: focused controls keep their native keys, the voice menu fits a 320-pixel screen, and Drafts has a visible close button. The older stack remains in Git history. Unfinished cloud-voice work on CT920 was left untouched.</p><p>The repository includes the comparison JSON, this deterministic report and the six-file baseline hash receipt. The final bundle differs from the live baseline because of those reviewed UI fixes.</p></section>
<footer><p class="meta">Canonical comparison SHA-256: <code>${digest}</code>. Regenerate with <code>node scripts/render-reconciliation.mjs</code>.</p></footer>
</main><script type="application/json" id="artifact-state">${JSON.stringify({...data,canonical_sha256:digest}).replaceAll('<','\\u003c')}</script></body></html>\n`;
fs.writeFileSync(`${stem}.md`, markdown);
fs.writeFileSync(`${stem}.html`, html);
console.log(JSON.stringify({canonical_sha256:digest, feature_rows:data.features.length, verification_rows:data.verification.length}));
