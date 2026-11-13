import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
}));
const maxFileBytes = 25 * 1024 * 1024;

function privateIpV4(address) {
  if (typeof address !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 0;
  const parts = address.split('.').map(Number);
  if (parts.some(part => part > 255)) return 0;
  if (parts[0] === 192 && parts[1] === 168) return 3;
  if (parts[0] === 10) return 2;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 1;
  return 0;
}

export function selectPreviewAddress({ lan = false, interfaces } = {}) {
  if (!lan) return '127.0.0.1';
  const addresses = [];
  for (const [name, adapters] of Object.entries(interfaces ?? os.networkInterfaces())) {
    for (const adapter of adapters ?? []) {
      if (adapter?.internal || !['IPv4', 4].includes(adapter?.family)) continue;
      const rank = privateIpV4(adapter.address);
      if (rank) addresses.push({ name, address: adapter.address, rank });
    }
  }
  addresses.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'en') ||
    a.address.localeCompare(b.address, 'en'));
  if (!addresses.length) throw new Error('PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE');
  return addresses[0].address;
}

function safePath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//')) return null;
  const raw = rawUrl.split(/[?#]/, 1)[0];
  if (/%2f|%5c/i.test(raw)) return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); }
  catch { return null; }
  if (decoded.includes('%') || decoded.includes('\\') || /[\0-\x1f\x7f:]/.test(decoded)) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const segments = relative.split('/');
  if (segments.some(segment => !segment || segment.startsWith('.') || segment === '..' ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) return null;
  if (!mime.has(path.posix.extname(relative).toLowerCase())) return null;
  return segments;
}

function safeRead(root, segments, rootIdentity) {
  const currentRoot = fs.lstatSync(root, { bigint: true });
  if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() ||
      `${currentRoot.dev}:${currentRoot.ino}` !== rootIdentity) throw new Error('PREVIEW_BUILD_ROOT_CHANGED');
  let location = root;
  for (const [index, segment] of segments.entries()) {
    location = path.join(location, segment);
    const stat = fs.lstatSync(location, { bigint: true });
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory()) ||
        (index === segments.length - 1 && (!stat.isFile() || stat.nlink !== 1n))) {
      throw new Error('PREVIEW_FILE_UNSAFE');
    }
  }
  const before = fs.lstatSync(location, { bigint: true });
  if (before.size === 0n || before.size > BigInt(maxFileBytes)) throw new Error('PREVIEW_FILE_UNSAFE');
  const fd = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== before.dev ||
        opened.ino !== before.ino || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs) {
      throw new Error('PREVIEW_FILE_CHANGED');
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs) throw new Error('PREVIEW_FILE_CHANGED');
    return bytes;
  } finally { fs.closeSync(fd); }
}

export async function startPreviewServer({ root, lan = false, port = 4173, interfaces,
  buildSha256 = null } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PREVIEW_PORT_INVALID');
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('PREVIEW_BUILD_ROOT_INVALID');
  const stat = fs.lstatSync(root, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PREVIEW_BUILD_ROOT_INVALID');
  const rootIdentity = `${stat.dev}:${stat.ino}`;
  const address = selectPreviewAddress({ lan, interfaces });
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const segments = safePath(request.url);
    if (!segments) { response.writeHead(404).end(); return; }
    try {
      const bytes = safeRead(root, segments, rootIdentity);
      const fileType = mime.get(path.posix.extname(segments.at(-1)).toLowerCase());
      response.writeHead(200, { 'Content-Type': fileType, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' || error.message === 'PREVIEW_FILE_UNSAFE' ? 404 : 503).end();
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  try {
    await new Promise((resolve, reject) => {
      const onError = error => { server.off('listening', onListen); reject(error); };
      const onListen = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, address);
    });
  } catch (error) {
    server.close();
    throw new Error(error.code === 'EADDRINUSE' ? 'PREVIEW_PORT_IN_USE' :
      error.code === 'EADDRNOTAVAIL' ? 'PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE' :
        `PREVIEW_LISTEN_FAILED: ${error.code ?? error.message}`);
  }
  const boundPort = server.address().port;
  let closePromise;
  return {
    url: `http://${address}:${boundPort}/`, address, port: boundPort, buildSha256,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve, reject) => {
        // A device that never finishes its request must not keep the CLI and
        // its temporary distribution alive after Ctrl+C.
        const deadline = setTimeout(() => {
          server.closeAllConnections?.();
          for (const socket of sockets) socket.destroy();
        }, 750);
        deadline.unref?.();
        server.close(error => {
          clearTimeout(deadline);
          error ? reject(error) : resolve();
        });
        server.closeIdleConnections?.();
      });
      return closePromise;
    },
  };
}
