import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distArg = process.argv[2] || 'dist';
const port = Number(process.argv[3] || 4522);
const distDir = path.resolve(__dirname, '..', distArg);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolvePath(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const stripped = safePath.replace(/^[/\\]+/, '');
  const directPath = path.join(distDir, stripped);

  if (await exists(directPath)) {
    const info = await stat(directPath);
    if (info.isDirectory()) {
      const indexPath = path.join(directPath, 'index.html');
      if (await exists(indexPath)) return indexPath;
    } else {
      return directPath;
    }
  }

  if (!path.extname(stripped)) {
    const htmlPath = path.join(distDir, `${stripped}.html`);
    if (await exists(htmlPath)) return htmlPath;
  }

  if (!stripped) {
    const rootIndex = path.join(distDir, 'index.html');
    if (await exists(rootIndex)) return rootIndex;
  }

  return path.join(distDir, '+not-found.html');
}

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const filePath = await resolvePath(requestUrl.pathname);
    const ext = path.extname(filePath);
    const status = path.basename(filePath) === '+not-found.html' ? 404 : 200;
    res.writeHead(status, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error instanceof Error ? error.message : 'Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Serving ${distDir} on http://127.0.0.1:${port}`);
});
