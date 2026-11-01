import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { selectPreviewAddress, startPreviewServer } from '../src/preview-server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-serve-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Fresh game</h1>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'image.svg'), '<svg/>');
  fs.writeFileSync(path.join(root, '.env'), 'secret-value');
  return root;
}

function request(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: rawPath, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('preview serves only built files with safe headers, HEAD and a stable digest', async t => {
  const root = fixture(t);
  const server = await startPreviewServer({ root, port: 0, buildSha256: 'a'.repeat(64) });
  t.after(async () => server.close());
  assert.equal(server.address, '127.0.0.1');
  assert.equal(server.url, `http://127.0.0.1:${server.port}/`);
  assert.equal(server.buildSha256, 'a'.repeat(64));
  const home = await request(server.port, '/');
  assert.equal(home.status, 200);
  assert.equal(home.text, '<h1>Fresh game</h1>');
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['cache-control'], 'no-store');
  const asset = await request(server.port, '/assets/image.svg');
  assert.equal(asset.status, 200);
  assert.equal(asset.text, '<svg/>');
  const head = await request(server.port, '/assets/image.svg', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal((await request(server.port, '/assets/image.svg', 'POST')).status, 405);
});

test('traversal, encoded paths, hidden files, directories and symlinks cannot be served', async t => {
  const root = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-serve-secret-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside-secret');
  fs.symlinkSync(path.join(outside, 'outside.txt'), path.join(root, 'assets', 'linked.svg'));
  const server = await startPreviewServer({ root, port: 0, buildSha256: 'b'.repeat(64) });
  t.after(async () => server.close());
  for (const url of [
    '/.env', '/assets/', '/assets/linked.svg', '/missing.txt',
    '/%2e%2e/outside.txt', '/assets/%2e%2e/index.html', '/assets/%2e%2e%2findex.html',
    '/assets/%252e%252e%252findex.html', '/assets/%5c..%5cindex.html', '/%00.env',
    '/C:%5cUsers%5csecret', '/assets/%2e%2e%5coutside.txt',
  ]) {
    const response = await request(server.port, url);
    assert.notEqual(response.status, 200, `Should reject ${url}`);
    assert.doesNotMatch(response.text, /outside-secret|secret-value/);
  }
});

test('LAN interface selection is opt-in and excludes public, loopback, link-local and Docker preference', () => {
  const interfaces = {
    docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.2' }],
    WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
    public0: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }],
    loop: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    link: [{ family: 'IPv4', internal: false, address: '169.254.0.1' }],
  };
  assert.equal(selectPreviewAddress({ interfaces }), '127.0.0.1');
  assert.equal(selectPreviewAddress({ lan: true, interfaces }), '192.168.1.42');
  assert.throws(() => selectPreviewAddress({ lan: true, interfaces: { eth0: [
    { family: 'IPv4', internal: false, address: '8.8.8.8' },
  ] } }), /PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE/);
});

test('unavailable port and LAN interface fail closed; close stops listener', async t => {
  const root = fixture(t);
  const server = await startPreviewServer({ root, port: 0 });
  t.after(async () => server.close());
  await assert.rejects(startPreviewServer({ root, port: server.port }), /PREVIEW_PORT_IN_USE/);
  await assert.rejects(startPreviewServer({ root, lan: true, port: 0, interfaces: {} }),
    /PREVIEW_PRIVATE_INTERFACE_UNAVAILABLE/);
  await server.close();
  await assert.rejects(request(server.port, '/'), /ECONNREFUSED|socket hang up/);
});

test('shutdown is bounded even if a connected client never completes the HTTP request', async t => {
  const root = fixture(t);
  const server = await startPreviewServer({ root, port: 0 });
  t.after(async () => server.close());
  const client = net.connect(server.port, '127.0.0.1');
  client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise(resolve => client.once('connect', resolve));
  client.write('GET /index.html HTTP/1.1\r\nHost: localhost\r\n');
  const closing = server.close();
  const finished = await Promise.race([
    closing.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 1500)),
  ]);
  client.destroy();
  await closing;
  assert.equal(finished, true, 'server.close must not wait indefinitely for a slow client');
});
