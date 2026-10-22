/**
 * Serveur HTTP statique minimal pour les pages de test (127.0.0.1 uniquement).
 * Usage manuel : npm run serve:test-pages  →  http://127.0.0.1:5174/
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'test-pages');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function startTestPagesServer(port = 0): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const file = normalize(join(ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Page introuvable');
    }
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      done({ server, baseUrl: `http://127.0.0.1:${actualPort}` });
    });
  });
}

if (import.meta.main) {
  const { baseUrl } = await startTestPagesServer(5174);
  console.log(`Pages de test disponibles sur ${baseUrl}/`);
}
