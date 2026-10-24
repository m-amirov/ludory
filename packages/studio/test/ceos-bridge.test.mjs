import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeCeos, fakeProject } from './helpers/fake-ceos.mjs';
import { resolveCeosEntry, invokeCeos } from '../src/ceos-bridge.mjs';

test('resolves exact CEOS 0.5.40 package and invokes its JS entry with literal argv', t => {
  const ceos = fakeCeos(t);
  const project = fakeProject(t);
  const resolved = resolveCeosEntry({ entry: ceos.entry });
  assert.equal(resolved.version, '0.5.40');
  assert.equal(resolved.entryPath, ceos.entry);
  const value = invokeCeos({ entryPath: resolved.entryPath, project, args: ['doctor', '--project', project, '--json', '--target', '$(touch hacked)'] });
  assert.equal(value.ceosExitCode, 0);
  assert.deepEqual(value.data.argv, ['doctor', '--project', project, '--json', '--target', '$(touch hacked)']);
  assert.equal(value.data.cwd, project);
  assert.equal(fs.existsSync(path.join(project, 'hacked')), false);
});

test('CEOS discovery honors explicit entry before LUDORY_CEOS_ENTRY and validates environment fallback', t => {
  const ceos = fakeCeos(t);
  const env = { LUDORY_CEOS_ENTRY: ceos.entry };
  assert.equal(resolveCeosEntry({ env }).entryPath, ceos.entry);
  assert.equal(resolveCeosEntry({ entry: ceos.entry, env: { LUDORY_CEOS_ENTRY: '/missing/ceos.mjs' } }).entryPath, ceos.entry);
  assert.throws(() => resolveCeosEntry({ env: { LUDORY_CEOS_ENTRY: '/missing/ceos.mjs' } }), /BLOCKED_CEOS_UNAVAILABLE/);
});

test('fails closed for wrong CEOS package name, unsupported version and mismatch', t => {
  const wrongName = fakeCeos(t, { packageName: 'not-ceos' });
  const wrongVersion = fakeCeos(t, { version: '0.5.41' });
  const mismatched = fakeCeos(t);
  fs.writeFileSync(path.join(mismatched.root, 'VERSION'), '0.5.39\n');
  assert.throws(() => resolveCeosEntry({ entry: wrongName.entry }), /BLOCKED_CEOS_ENTRY/);
  assert.throws(() => resolveCeosEntry({ entry: wrongVersion.entry }), /BLOCKED_CEOS_VERSION/);
  assert.throws(() => resolveCeosEntry({ entry: mismatched.entry }), /BLOCKED_CEOS_VERSION/);
});

test('rejects missing/relative CEOS entry and broken symlink safely', t => {
  const project = fakeProject(t);
  const stale = path.join(project, 'ceos-stale.mjs');
  fs.symlinkSync(path.join(project, 'missing-ceos.mjs'), stale);
  assert.throws(() => resolveCeosEntry({ entry: './ceos.mjs' }), /BLOCKED_CEOS_ENTRY/);
  assert.throws(() => resolveCeosEntry({ entry: stale }), /BLOCKED_CEOS_ENTRY|BLOCKED_CEOS_UNAVAILABLE/);
  assert.throws(() => resolveCeosEntry({ env: { LUDORY_CEOS_ENTRY: path.join(project, 'missing.mjs') } }), /BLOCKED_CEOS_ENTRY|BLOCKED_CEOS_UNAVAILABLE/);
});

test('keeps CEOS exit 2/3 and fails on invalid JSON, overflow and timeout', t => {
  const ceos = fakeCeos(t);
  const project = fakeProject(t);
  const blocked = invokeCeos({ entryPath: ceos.entry, project, args: ['continue', '--mode', 'inspect', '--blocked', '--json'] });
  assert.equal(blocked.ceosExitCode, 2);
  assert.equal(blocked.data.status, 'BLOCKED');
  const escalated = invokeCeos({ entryPath: ceos.entry, project, args: ['doctor', '--escalate', '--json'] });
  assert.equal(escalated.ceosExitCode, 3);
  assert.throws(() => invokeCeos({ entryPath: ceos.entry, project, args: ['doctor', '--invalid-json'] }), /CEOS_INVALID_JSON/);
  // Some process wrappers truncate a large stdout without surfacing ENOBUFS;
  // either a bounded-output error or rejected truncated JSON is fail-closed.
  assert.throws(() => invokeCeos({ entryPath: ceos.entry, project, args: ['doctor', '--oversize'] }), /CEOS_(OVERFLOW|INVALID_JSON|EXECUTION_ERROR)/);
  assert.throws(() => invokeCeos({ entryPath: ceos.entry, project, args: ['doctor', '--hang'], timeoutMs: 150 }), /CEOS_TIMEOUT/);
});
