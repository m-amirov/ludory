// Self-contained test executed by Codex with `node --test <relative-path>`.
// No Studio host process runs generated game tests or external quality tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const sha256 = input => crypto.createHash('sha256').update(input).digest('hex');
const dirname = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(dirname, '../../../../');
const requestPath = path.join(dirname, 'request.json');
const outputPath = path.join(dirname, 'report.json');
const SKIP = new Set(['.git', '.ludory', 'node_modules', 'coverage', 'dist', 'build', 'target', '.worktrees']);

function filesUnder(dir, predicate, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('QUALITY_SOURCE_SYMBOLIC');
    if (stat.isDirectory()) found.push(...filesUnder(full, predicate, relative));
    else if (stat.isFile() && predicate(relative)) found.push(relative);
  }
  return found;
}

function run(executable, args, timeoutMs) {
  const command = [executable, ...args];
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'NODE_ENV']
    .filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
  const outcome = spawnSync(executable, args, { cwd: project, shell: false, encoding: 'utf8',
    timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true, env });
  const combined = `${outcome.stdout ?? ''}\n${outcome.stderr ?? ''}`;
  return { command, exitCode: Number.isSafeInteger(outcome.status) ? outcome.status : null,
    observed: !outcome.error && !outcome.signal && outcome.status !== null,
    outputSha256: sha256(combined), outputBytes: Buffer.byteLength(combined),
    output: combined, error: outcome.error?.code ?? (outcome.signal ? 'QUALITY_TIMEOUT' : null) };
}

function artifact(relative, startedAt) {
  if (!/^(?:coverage\/lcov\.info|\.metrics\/(?:crap\.edn|dry\.edn|mutate\/[A-Za-z0-9_.-]+\.edn))$/.test(relative)) {
    return null;
  }
  let current = project;
  try {
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return null;
      if (current !== path.join(project, relative) && !stat.isDirectory()) return null;
    }
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024 || stat.mtimeMs < startedAt - 500) {
      return null;
    }
    const bytes = fs.readFileSync(current);
    return { path: relative, sha256: sha256(bytes), size: bytes.length };
  } catch { return null; }
}

function metricArtifacts(name, startedAt) {
  if (name !== 'mutator') return [artifact(name === 'crapper'
    ? '.metrics/crap.edn' : '.metrics/dry.edn', startedAt)].filter(Boolean);
  const dirname = path.join(project, '.metrics', 'mutate');
  try {
    const stat = fs.lstatSync(dirname);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
    const names = fs.readdirSync(dirname).sort();
    if (!names.length || names.length > 16) return [];
    return names.map(item => artifact(`.metrics/mutate/${item}`, startedAt)).filter(Boolean);
  } catch { return []; }
}

function toolResult(name, tool, args) {
  if (!tool) return { name, status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_MISSING', observed: false, exitCode: null };
  try {
    const stat = fs.lstatSync(tool.path);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(tool.path)) !== tool.sha256) {
      return { name, status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_CHANGED', observed: false, exitCode: null };
    }
    const startedAt = Date.now();
    const result = run(tool.path, args, tool.timeoutMs);
    const post = sha256(fs.readFileSync(tool.path));
    const artifacts = metricArtifacts(name, startedAt);
    const status = post !== tool.sha256 || !result.observed || (result.exitCode === 0 && !artifacts.length) ? 'BLOCKED'
      : result.exitCode === 0 && !(name === 'dryer' && /(?:^|\n)DUPLICATE\s+score=/i.test(result.output)) ? 'PASS'
        : name === 'mutator' && result.exitCode === 2 ? 'BLOCKED' : 'FAIL';
    return { name, status, reasonCode: status === 'BLOCKED'
      ? post !== tool.sha256 ? 'QUALITY_TOOL_CHANGED' : result.error ??
        (!artifacts.length && result.exitCode === 0 ? 'QUALITY_METRIC_MISSING' : 'QUALITY_TOOL_FAILED')
      : status === 'FAIL' ? `QUALITY_${name.toUpperCase()}_FAILED` : null,
    observed: result.observed, exitCode: result.exitCode, command: result.command,
    toolSha256: tool.sha256, version: tool.version,
    outputSha256: result.outputSha256, outputBytes: result.outputBytes, artifacts };
  } catch (error) {
    return { name, status: 'BLOCKED', reasonCode: error.code ?? 'QUALITY_TOOL_UNAVAILABLE',
      observed: false, exitCode: null };
  }
}

test('bounded Engineering Quality checks produce a source-bound report', () => {
  const requestBytes = fs.readFileSync(requestPath);
  assert.ok(requestBytes.length < 32 * 1024, 'bounded request');
  const request = JSON.parse(requestBytes.toString('utf8'));
  assert.equal(request.schemaVersion, 1);
  assert.ok(['quick', 'deep'].includes(request.tier));
  assert.match(request.sourceDigest, /^[a-f0-9]{64}$/);
  const testPaths = filesUnder(project, name => /(?:^|\/)\S+\.test\.[cm]?js$/.test(name));
  const codePaths = filesUnder(path.join(project, 'src'), name => /\.[cm]?js$/.test(name))
    .map(name => `src/${name}`).filter(name => !/\.test\./.test(name));
  const checks = [];
  let coverageReady = false;
  if (!testPaths.length) {
    checks.push({ name: 'tests', status: 'BLOCKED', reasonCode: 'QUALITY_TESTS_MISSING',
      observed: false, exitCode: null });
  } else {
    const testStarted = Date.now();
    const tested = run(process.execPath, ['--test', ...testPaths], 120_000);
    const status = !tested.observed ? 'BLOCKED' : tested.exitCode === 0 ? 'PASS' : 'FAIL';
    checks.push({ name: 'tests', status,
      reasonCode: status === 'PASS' ? null : status === 'BLOCKED' ? 'QUALITY_TEST_RUNNER_UNAVAILABLE' : 'QUALITY_TESTS_FAILED',
      observed: tested.observed, exitCode: tested.exitCode, command: tested.command,
      version: process.version, outputSha256: tested.outputSha256, outputBytes: tested.outputBytes });
    const coverage = artifact('coverage/lcov.info', testStarted);
    coverageReady = !!coverage;
    if (coverage) checks[0].artifacts = [coverage];
  }
  const scope = codePaths.length ? codePaths : ['src'];
  const metrics = ['crapper', 'dryer', ...(request.tier === 'deep' ? ['mutator'] : [])];
  for (const name of metrics) {
    if (checks[0].status !== 'PASS' || (name !== 'dryer' && !coverageReady)) {
      checks.push({ name, status: 'BLOCKED', reasonCode: checks[0].status !== 'PASS'
        ? 'QUALITY_TESTS_NOT_PASSING' : 'QUALITY_COVERAGE_MISSING', observed: false, exitCode: null });
      continue;
    }
    // Crapper rejects scores ABOVE its limit; use an explicit exclusive bound for CRAP < 10.
    const args = name === 'crapper' ? ['--use-existing-coverage', '--threshold', '9.999999', ...scope]
      : name === 'dryer' ? ['--threshold', '0.8', ...scope]
        : ['--use-existing-coverage', '--max-workers', '2', ...scope];
    checks.push(toolResult(name, request.tools[name], args));
  }
  const artifacts = checks.flatMap(check => check.artifacts ?? []);
  const report = { schemaVersion: 1, tier: request.tier, sourceDigest: request.sourceDigest,
    requestSha256: sha256(requestBytes), checks, artifacts };
  const output = `${JSON.stringify(report)}\n`;
  assert.ok(Buffer.byteLength(output) <= 256 * 1024, 'bounded report');
  fs.writeFileSync(outputPath, output, { flag: 'wx', mode: 0o600 });
});
