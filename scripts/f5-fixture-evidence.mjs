import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { planCreate, applyCreatePlan } from '../packages/studio/src/scaffold.mjs';
import { runCli } from '../packages/studio/src/cli.mjs';
import { buildYandexCandidate } from './build-yandex-candidate.mjs';
import { buildVkCandidate } from './build-vk-candidate.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shaPattern = /^[a-f0-9]{64}$/;
const safeScreenshot = /^[a-z0-9][a-z0-9-]*\.png$/;
const fixtures = [
  { name: 'narrative', id: 'f5-disposable-story', title: 'Одноразовая история F5', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] },
  { name: 'yandex', id: 'f5-disposable-yandex', title: 'F5 Yandex dry run', lang: 'en',
    profile: 'web-game', template: 'yandex-runtime', targets: ['yandex-games'] },
  { name: 'vk', id: 'f5-disposable-vk', title: 'F5 VK dry run', lang: 'en',
    profile: 'web-game', template: 'vk-runtime', targets: ['vk-games'] },
];

function treeSha256(root) {
  const files = [];
  function visit(directory, prefix = '') {
    for (const basename of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${basename}` : basename;
      const filename = path.join(directory, basename);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error(`F5 fixture unexpectedly contains a link: ${relative}`);
      if (stat.isDirectory()) visit(filename, relative);
      else if (stat.isFile()) files.push({ path: relative, sha256: sha256(fs.readFileSync(filename)), size: stat.size });
      else throw new Error(`F5 fixture contains a non-regular file: ${relative}`);
    }
  }
  visit(root);
  return sha256(Buffer.from(JSON.stringify(files)));
}

function admitOutput(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new TypeError('F5 outputDir is required');
  const output = path.resolve(outputDir);
  const parent = path.dirname(output);
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('F5 output parent must be a real directory');
  // mkdir is exclusive: existing evidence, empty directories and symbolic links are all user-owned.
  fs.mkdirSync(output);
  return output;
}

function verifyCandidate(outputDir, target, result) {
  const file = `${target}-candidate.zip`;
  const bytes = fs.readFileSync(path.join(outputDir, file));
  if (result.sha256 !== sha256(bytes)) throw new Error(`F5 candidate ${target} archive hash mismatch`);
  const entries = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(entries).sort();
  const expected = result.files.map(item => item.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`F5 candidate ${target} ZIP file inventory mismatch`);
  }
  for (const info of result.files) {
    if (entries[info.path].byteLength !== info.size || sha256(entries[info.path]) !== info.sha256) {
      throw new Error(`F5 candidate ${target} ZIP member hash mismatch: ${info.path}`);
    }
  }
  return { file, sha256: sha256(bytes), bytes: bytes.byteLength,
    files: result.files.map(item => ({ path: item.path, sha256: item.sha256, size: item.size })) };
}

function verifyBrowserObservation(result, outputDir) {
  if (!result || result.status !== 'OBSERVED_PASS' || !Array.isArray(result.cases)) {
    throw new Error('F5 browser observation must report explicit observed cases');
  }
  const names = result.cases.map(item => item.name);
  if (names.length !== 2 || new Set(names).size !== 2 ||
      !names.includes('desktop-wide') || !names.includes('android-portrait-emulated')) {
    throw new Error('F5 browser observation must cover wide desktop and emulated portrait');
  }
  for (const item of result.cases) {
    if (item.status !== 'PASS' || !Array.isArray(item.pageErrors) || item.pageErrors.length ||
        !Array.isArray(item.consoleErrors ?? []) || (item.consoleErrors ?? []).length ||
        !Array.isArray(item.externalRequests) || item.externalRequests.length ||
        !safeScreenshot.test(item.screenshot?.file) || !shaPattern.test(item.screenshot?.sha256)) {
      throw new Error(`F5 browser observation invalid for ${item.name}`);
    }
    const file = path.join(outputDir, item.screenshot.file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`F5 browser screenshot is missing or does not match: ${item.name}`);
    }
    const png = fs.readFileSync(file);
    if (sha256(png) !== item.screenshot.sha256 || png.length < 33 ||
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        png.toString('ascii', 12, 16) !== 'IHDR' ||
        png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0) {
      throw new Error(`F5 browser screenshot is not a matching PNG: ${item.name}`);
    }
  }
  if (!['BLOCKED_OFFLINE_STARTUP', 'PASS_OFFLINE'].includes(result.offlineStartup)) {
    throw new Error('F5 browser must report the actual offline-startup outcome');
  }
  return result;
}

async function nativeAiHandoff(projectDir) {
  let hostInvocations = 0;
  const commands = [];
  const cli = async (...args) => {
    let stdout = '', stderr = '';
    const exitCode = await runCli(args, { out: chunk => { stdout += chunk; },
      err: chunk => { stderr += chunk; },
      devHost: () => { hostInvocations++; throw new Error('F5_NO_EXTERNAL_HOST'); } });
    let data;
    try { data = JSON.parse(stdout); }
    catch { throw new Error(`F5 native AI CLI did not return JSON (${exitCode}): ${stderr || stdout}`); }
    commands.push({ command: args[0] === 'workflow' ? `workflow ${args[1]}` : args[0],
      exitCode, status: data.status, reasonCode: data.reasonCode ?? null });
    return data;
  };
  fs.writeFileSync(path.join(projectDir, 'scene-brief.md'),
    'Нарисуй оригинальный маяк на сумеречном берегу для одноразовой тестовой истории.');
  const doctor = await cli('workflow', 'doctor', '--project', projectDir, '--json');
  const route = await cli('workflow', 'route', '--project', projectDir, '--task', 'image', '--json');
  const start = await cli('workflow', 'start', '--project', projectDir, '--pipeline', 'production-art',
    '--target', 'F5 Disposable Lighthouse', '--in-scope', 'scene-brief.md',
    '--acceptance', 'source-bound F5 handoff only', '--mutation-boundary', 'temporary fixture only', '--apply', '--json');
  if (start.status !== 'APPLIED' || !start.runId) throw new Error('F5 native AI workflow did not create a native run');
  const image = await cli('workflow', 'image', '--project', projectDir, '--run', start.runId,
    '--brief', 'scene-brief.md', '--json');
  if (hostInvocations !== 0 || image.status !== 'NEEDS_AGENT_ACTION' ||
      image.modelObserved !== null || route.status !== 'NEEDS_AGENT_ACTION') {
    throw new Error('F5 AI handoff was not an honest unexecuted external operation');
  }
  return { doctor: { status: doctor.status }, route: { status: route.status, selectedRoute: route.selectedRoute },
    nativeRunId: start.runId, image: { status: image.status, modelObserved: image.modelObserved,
      briefSha256: image.brief?.sha256 ?? null }, hostInvocations, commands };
}

/** F5 local evidence. Multiple SDK templates are NOT falsely represented as one released narrative build. */
export async function runF5Fixture({ outputDir, observeNarrative } = {}) {
  const output = admitOutput(outputDir);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5-disposable-'));
  const receipt = {
    schemaVersion: 1, phase: 'F5', runId: `f5-${randomUUID()}`,
    checkedHead: null,
    status: 'PARTIAL_BLOCKED', fixtures: {}, candidates: {},
    narrativePackaging: { status: 'BLOCKED', reasonCode: 'STORY_TARGET_PACKAGING_BLOCKED',
      detail: 'The Studio narrative-interactive template is not a trusted yandex-runtime or vk-runtime SDK candidate; the two ZIPs below are separate games.' },
    browser: { status: 'NOT_RUN', reasonCode: 'F5_BROWSER_NOT_PROVIDED' },
    actualModeration: 'NOT_RUN', physicalDevices: 'NOT_RUN', liveAi: 'NOT_RUN',
    liveYandex: 'NOT_RUN', liveVk: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
    nonDestructive: { temporaryRoot, temporaryProjectsRemoved: false,
      existingProjectsOpened: false, exclusiveOutput: true },
  };
  let failure;
  let stage = 'STUDIO_FIXTURE_CREATION';
  try {
    receipt.checkedHead = execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8' }).trim();
    if (!/^[a-f0-9]{40}$/.test(receipt.checkedHead)) throw new Error('F5 Git HEAD is not a full commit SHA');
    const dirs = {};
    for (const info of fixtures) {
      const project = path.join(temporaryRoot, info.name);
      fs.mkdirSync(project);
      const plan = planCreate(project, { id: info.id, version: '0.1.0', title: info.title,
        lang: info.lang, profile: info.profile, template: info.template, targets: info.targets });
      if (plan.status !== 'READY' || applyCreatePlan(plan).status !== 'APPLIED') {
        throw new Error(`F5 Studio could not create disposable ${info.name} game`);
      }
      dirs[info.name] = project;
      receipt.fixtures[info.name] = { template: info.template, profile: info.profile,
        targets: [...info.targets], treeSha256: treeSha256(project) };
    }
    stage = 'NATIVE_AI_HANDOFF';
    receipt.ai = await nativeAiHandoff(dirs.narrative);
    // The brief and native AI receipt are part of the tested narrative fixture.
    receipt.fixtures.narrative.treeSha256 = treeSha256(dirs.narrative);
    stage = 'TARGET_CANDIDATES';
    for (const [target, build] of [['yandex', buildYandexCandidate], ['vk', buildVkCandidate]]) {
      const result = await build({ projectDir: dirs[target], outputZip: path.join(output, `${target}-candidate.zip`) });
      receipt.candidates[target] = verifyCandidate(output, target, result);
    }
    if (observeNarrative) {
      stage = 'BROWSER_OBSERVATION';
      receipt.browser = verifyBrowserObservation(await observeNarrative({ projectDir: dirs.narrative, outputDir: output }), output);
    }
  } catch (error) {
    failure = error;
    receipt.status = 'ISSUES_FOUND';
    if (stage === 'BROWSER_OBSERVATION') {
      const unavailable = /Executable doesn't exist|browserType\.launch/i.test(String(error.message));
      receipt.browser = { status: unavailable ? 'BLOCKED' : 'ISSUES_FOUND',
        reasonCode: unavailable ? 'F5_BROWSER_EXECUTABLE_UNAVAILABLE' : 'F5_BROWSER_OBSERVATION_FAILED' };
    }
    receipt.failure = { reasonCode: 'F5_FIXTURE_OR_OBSERVATION_FAILED', stage, message: String(error.message) };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    receipt.nonDestructive.temporaryProjectsRemoved = !fs.existsSync(temporaryRoot);
  }
  fs.writeFileSync(path.join(output, 'f5-evidence.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  if (failure) throw failure;
  return receipt;
}
