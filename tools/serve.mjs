// Local preview server (dev only, never deployed as code). Serves the folder
// the way Cloudflare Pages does: /about → about.html, plus the rules in _headers,
// so the Content-Security-Policy is exercised locally too. Unknown paths get
// 404.html with status 404, as on Pages.
//   node tools/serve.mjs        →  serves the repo       http://localhost:8788
//   node tools/serve.mjs dist   →  serves the build output (after npm run build)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(repo, process.argv[2] || '.') + sep;
const port = Number(process.env.PORT) || 8788;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function headerRules() {
  const rules = [];
  const text = await readFile(join(root, '_headers'), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
    else if (rules.length) {
      const at = line.indexOf(':');
      rules[rules.length - 1].headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return rules;
}

const matches = (pattern, path) =>
  pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  for (const rule of await headerRules()) {
    if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) res.setHeader(name, value);
  }
  const rel = normalize(path === '/' ? '/index.html' : extname(path) ? path : path + '.html');
  const file = join(root, rel);
  try {
    if (!file.startsWith(root) || rel.split(sep).some((part) => part.startsWith('.'))) throw new Error('outside');
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    const page = await readFile(join(root, '404.html')).catch(() => null);
    res.setHeader('Content-Type', page ? TYPES['.html'] : 'text/plain; charset=utf-8');
    res.end(page || 'Not found');
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}`));
