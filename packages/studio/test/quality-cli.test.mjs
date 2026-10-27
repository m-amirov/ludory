import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { qualityGame } from '../../ai/test/helpers/quality-game.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';

function cli(...args) {
  let stdout = '', stderr = '';
  const status = runCli(args, { out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { status, stdout, stderr, result: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}

test('Studio Quality enable is opt-in and preview does not create any files', t => {
  const project = qualityGame(t);
  const root = ['quality', 'enable', '--project', project, '--json'];
  const preview = cli(...root);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.result.status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  const applied = cli(...root, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.result.status, 'ENABLED');
  assert.equal(cli(...root).result.status, 'IN_SYNC');
  assert.equal(cli('quality', 'status', '--project', project, '--json').result.status, 'NOT_RUN');
  assert.equal(cli('quality', 'evidence', '--project', project, '--json').result.status, 'NOT_RUN');
});

test('disabled/frozen projects and unavailable tools stay blocked without invoking Codex', t => {
  const old = nativeProject(t);
  assert.equal(cli('quality', 'enable', '--project', old, '--apply', '--json').result.status, 'BLOCKED');
  const project = qualityGame(t);
  assert.equal(cli('quality', 'check', '--project', project, '--tier', 'quick', '--apply', '--json').result.status, 'BLOCKED');
  cli('quality', 'enable', '--project', project, '--apply', '--json');
  const checked = cli('quality', 'check', '--project', project, '--tier', 'deep', '--apply', '--json');
  assert.equal(checked.status, 2);
  assert.equal(checked.result.status, 'BLOCKED');
  assert.match(checked.result.conflicts.join(' '), /crapper|mutator/i);
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'quality', 'attempts')), false);
});

test('Quality commands reject unknown options and mutating read-only operations', t => {
  const project = qualityGame(t);
  const base = ['--project', project, '--json'];
  assert.equal(cli('quality', 'enable', ...base, '--unsafe').status, 1);
  assert.equal(cli('quality', 'status', ...base, '--apply').status, 1);
  assert.equal(cli('quality', 'evidence', ...base, '--run', '../outside').status, 2);
  assert.match(cli('help').stdout, /ludory quality enable/);
});
