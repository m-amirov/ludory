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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
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

// Parse the bounded EDN subset used by the upstream machine snapshots. Unknown
// syntax and incomplete records are BLOCKED; stdout/exit zero is not a score.
function metricEdn(bytes) {
  const input = bytes.toString('utf8');
  let index = 0;
  let tokens = 0;
  function space() { while (index < input.length && /[\s,]/.test(input[index])) index++; }
  function value(depth = 0) {
    space();
    if (++tokens > 50_000 || depth > 24 || index >= input.length) throw new Error('QUALITY_METRIC_FORMAT');
    const token = input[index];
    if (token === '{' || token === '[') {
      index++;
      const isMap = token === '{';
      const end = isMap ? '}' : ']';
      const result = isMap ? Object.create(null) : [];
      while (true) {
        space();
        if (index >= input.length) throw new Error('QUALITY_METRIC_FORMAT');
        if (input[index] === end) { index++; return result; }
        const item = value(depth + 1);
        if (isMap) {
          if (typeof item !== 'string') throw new Error('QUALITY_METRIC_FORMAT');
          const key = item.startsWith(':') ? item.slice(1) : item;
          if (Object.hasOwn(result, key)) throw new Error('QUALITY_METRIC_FORMAT');
          result[key] = value(depth + 1);
        } else result.push(item);
      }
    }
    if (token === '"') {
      const start = index++;
      while (index < input.length) {
        if (input[index] === '\\') { index += 2; continue; }
        if (input[index++] === '"') return JSON.parse(input.slice(start, index));
      }
      throw new Error('QUALITY_METRIC_FORMAT');
    }
    const match = /^(?::[a-zA-Z_][\w.?!\/-]*|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|nil|true|false)/.exec(input.slice(index));
    if (!match) throw new Error('QUALITY_METRIC_FORMAT');
    index += match[0].length;
    if (match[0] === 'nil') return null;
    if (match[0] === 'true') return true;
    if (match[0] === 'false') return false;
    if (match[0].startsWith(':')) return match[0];
    const number = Number(match[0]);
    if (!Number.isFinite(number)) throw new Error('QUALITY_METRIC_FORMAT');
    return number;
  }
  const parsed = value();
  space();
  if (index !== input.length || !parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('QUALITY_METRIC_FORMAT');
  }
  return parsed;
}

function metricOutcome(name, artifacts) {
  try {
    if (!artifacts.length) return 'BLOCKED';
    const reports = artifacts.map(item => metricEdn(fs.readFileSync(path.join(project, item.path))));
    if (name === 'crapper') {
      if (reports.length !== 1 || !Array.isArray(reports[0].entries) || !reports[0].entries.length ||
          reports[0].entries.some(e => !e || typeof e.name !== 'string' ||
            typeof e.crap !== 'number' || e.crap < 0)) return 'BLOCKED';
      return reports[0].entries.some(e => e.crap >= 10) ? 'FAIL' : 'PASS';
    }
    if (name === 'dryer') {
      if (reports.length !== 1 || !Array.isArray(reports[0].candidates) ||
          reports[0].candidates.some(e => !e || typeof e.score !== 'number' ||
            e.score < 0 || e.score > 1)) return 'BLOCKED';
      return reports[0].candidates.some(e => e.score >= 0.8) ? 'FAIL' : 'PASS';
    }
    if (name === 'mutator') {
      const forms = reports.flatMap(item => Array.isArray(item.forms) ? item.forms : [null]);
      if (!forms.length || forms.some(form => !form || ['killed', 'survived', 'uncovered']
        .some(key => !Number.isSafeInteger(form[key]) || form[key] < 0))) return 'BLOCKED';
      return forms.some(form => form.survived > 0 || form.uncovered > 0) ? 'FAIL' : 'PASS';
    }
  } catch { /* Invalid or incomplete machine reports never certify a pass. */ }
  return 'BLOCKED';
}

function coverageEvidence(entry, beforeChangeNs, startedAt, codePaths) {
  if (!entry) return false;
  try {
    const file = path.join(project, entry.path);
    const stat = fs.lstatSync(file, { bigint: true });
    if (beforeChangeNs !== null ? stat.ctimeNs <= beforeChangeNs :
      stat.ctimeNs < BigInt(startedAt - 500) * 1_000_000n) return false;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const validSources = new Set(codePaths);
    let active = false, hasLines = false, completed = 0;
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('TN:')) continue;
      if (line.startsWith('SF:')) {
        if (active) return false;
        const relative = path.relative(project, path.resolve(project, line.slice(3))).split(path.sep).join('/');
        if (!validSources.has(relative)) return false;
        active = true; hasLines = false;
      } else if (line.startsWith('DA:')) {
        if (!active || !/^DA:[1-9]\d*,\d+(?:,[a-zA-Z0-9]+)?$/.test(line)) return false;
        hasLines = true;
      } else if (line === 'end_of_record') {
        if (!active || !hasLines) return false;
        active = false; completed++;
      } else if (!/^(?:FN:\d+,.+|FNDA:\d+,.+|FNF:\d+|FNH:\d+|BRDA:\d+,\d+,\d+,(?:\d+|-)|BRF:\d+|BRH:\d+|LF:\d+|LH:\d+)$/.test(line)) {
        return false;
      }
    }
    return !active && completed > 0;
  } catch { return false; }
}

function toolResult(name, tool, args) {
  if (!tool) return { name, status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_MISSING', observed: false, exitCode: null };
  try {
    const stat = fs.lstatSync(tool.path);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(tool.path)) !== tool.sha256) {
      return { name, status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_CHANGED', observed: false, exitCode: null };
    }
    const previous = new Map(metricArtifacts(name, 0).map(item => [item.path,
      fs.lstatSync(path.join(project, item.path), { bigint: true }).ctimeNs]));
    const startedAt = Date.now();
    // Windows cannot directly spawn a shebang script with shell:false.
    // A pinned .mjs entrypoint is always launched by the current Node runtime.
    const isNodeScript = path.extname(tool.path).toLowerCase() === '.mjs';
    const result = run(isNodeScript ? process.execPath : tool.path,
      isNodeScript ? [tool.path, ...args] : args, tool.timeoutMs);
    const post = sha256(fs.readFileSync(tool.path));
    const artifacts = metricArtifacts(name, startedAt).filter(item => {
      const modified = fs.lstatSync(path.join(project, item.path), { bigint: true }).ctimeNs;
      return previous.has(item.path) ? modified > previous.get(item.path) :
        modified >= BigInt(startedAt - 500) * 1_000_000n;
    });
    const metrics = metricOutcome(name, artifacts);
    const status = post !== tool.sha256 || !result.observed || metrics === 'BLOCKED' ? 'BLOCKED'
      : result.exitCode === 0 ? metrics : 'FAIL';
    return { name, status, reasonCode: status === 'BLOCKED'
      ? post !== tool.sha256 ? 'QUALITY_TOOL_CHANGED' : result.error ??
        (metrics === 'BLOCKED' ? 'QUALITY_METRIC_UNTRUSTED' : 'QUALITY_TOOL_FAILED')
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
  const codePaths = filesUnder(path.join(project, 'src'), name => /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(name))
    .map(name => `src/${name}`).filter(name => !/\.test\./.test(name));
  const checks = [];
  let coverageReady = false;
  if (!testPaths.length) {
    checks.push({ name: 'tests', status: 'BLOCKED', reasonCode: 'QUALITY_TESTS_MISSING',
      observed: false, exitCode: null });
  } else {
    const testStarted = Date.now();
    let previousCoverageChange = null;
    try { previousCoverageChange = fs.lstatSync(path.join(project, 'coverage', 'lcov.info'),
      { bigint: true }).ctimeNs; } catch { /* Fresh coverage may not exist yet. */ }
    const tested = run(process.execPath, ['--test', ...testPaths], 120_000);
    const status = !tested.observed ? 'BLOCKED' : tested.exitCode === 0 ? 'PASS' : 'FAIL';
    checks.push({ name: 'tests', status,
      reasonCode: status === 'PASS' ? null : status === 'BLOCKED' ? 'QUALITY_TEST_RUNNER_UNAVAILABLE' : 'QUALITY_TESTS_FAILED',
      observed: tested.observed, exitCode: tested.exitCode, command: tested.command,
      version: process.version, outputSha256: tested.outputSha256, outputBytes: tested.outputBytes });
    const coverage = artifact('coverage/lcov.info', testStarted);
    coverageReady = coverageEvidence(coverage, previousCoverageChange, testStarted, codePaths);
    if (coverageReady) checks[0].artifacts = [coverage];
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
