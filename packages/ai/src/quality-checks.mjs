import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNativeProject } from './source.mjs';
import { prepareCodexExecution, checkCodexAvailable, runCodexExecution } from './executor.mjs';
import { qualityDigest, readQualityPolicy, planQualityEnable, safeQualityDirectory,
  safeQualityFile, snapshotQualitySource } from './quality-policy.mjs';
import { persistQualityReceipt } from './quality-store.mjs';
import { verifyStudioOrigin } from '@ludory/studio-trust';

const RUNNER = fileURLToPath(new URL('./quality-runner.mjs', import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const CHECK_NAMES = { quick: ['tests', 'crapper', 'dryer'], deep: ['tests', 'crapper', 'dryer', 'mutator'] };

function checkedTool(name, tool) {
  if (!tool) return `QUALITY_TOOL_MISSING: ${name}`;
  try {
    const stat = fs.lstatSync(tool.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024 ||
        qualityDigest(fs.readFileSync(tool.path)) !== tool.sha256) return `QUALITY_TOOL_CHANGED: ${name}`;
    if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(tool.path)) return `QUALITY_TOOL_UNSUPPORTED: ${name}`;
  } catch { return `QUALITY_TOOL_UNAVAILABLE: ${name}`; }
  return null;
}

export function planQualityCheck(projectDir, { tier = 'quick' } = {}) {
  const project = path.resolve(projectDir);
  if (!(tier in CHECK_NAMES)) return { mode: 'quality-check', project, tier, status: 'BLOCKED',
    conflicts: ['QUALITY_TIER_INVALID'], writes: [] };
  try {
    if (planQualityEnable(project).status !== 'IN_SYNC') throw new Error('QUALITY_NOT_ENABLED');
    const policy = readQualityPolicy(project);
    const source = snapshotQualitySource(project);
    const requiredTools = CHECK_NAMES[tier].filter(name => name !== 'tests');
    const conflicts = requiredTools.map(name => checkedTool(name, policy.tools[name])).filter(Boolean);
    if (conflicts.length) return { mode: 'quality-check', project, tier, status: 'BLOCKED',
      reasonCode: conflicts[0].split(':')[0], conflicts, writes: [] };
    const policyDigest = qualityDigest(JSON.stringify(policy));
    return { mode: 'quality-check', project, tier, status: 'READY', writes: [],
      sourceDigest: source.digest, rootIdentity: source.rootIdentity, policyDigest,
      fingerprint: qualityDigest(JSON.stringify({ project, tier, sourceDigest: source.digest,
        rootIdentity: source.rootIdentity, policyDigest })) };
  } catch (error) {
    return { mode: 'quality-check', project, tier, status: 'BLOCKED',
      reasonCode: error.message.split(':')[0], conflicts: [error.message], writes: [] };
  }
}

function checkedReport(project, relative, requestSha256, expectedTier, expectedSource, tools) {
  const bytes = fs.readFileSync(safeQualityFile(project, relative));
  if (bytes.length > 256 * 1024) throw new Error('QUALITY_REPORT_TOO_LARGE');
  const report = JSON.parse(bytes.toString('utf8'));
  if (report.schemaVersion !== 1 || report.tier !== expectedTier ||
      report.sourceDigest !== expectedSource || report.requestSha256 !== requestSha256 ||
      !Array.isArray(report.checks) || report.checks.length !== CHECK_NAMES[expectedTier].length ||
      !Array.isArray(report.artifacts) || report.artifacts.length > 20) {
    throw new Error('QUALITY_REPORT_UNTRUSTED');
  }
  for (const [index, name] of CHECK_NAMES[expectedTier].entries()) {
    const check = report.checks[index];
    if (check?.name !== name || !['PASS', 'FAIL', 'BLOCKED'].includes(check.status) ||
        (check.status === 'PASS' && (!check.observed || check.exitCode !== 0))) {
      throw new Error('QUALITY_REPORT_UNTRUSTED');
    }
    const isNodeScript = name !== 'tests' && path.extname(tools[name].path).toLowerCase() === '.mjs';
    if (name !== 'tests' && check.observed &&
        (check.toolSha256 !== tools[name].sha256 || check.version !== tools[name].version ||
          !Array.isArray(check.command) ||
          (isNodeScript ? check.command[0] !== process.execPath || check.command[1] !== tools[name].path
            : check.command[0] !== tools[name].path) ||
          !SHA.test(check.outputSha256))) throw new Error('QUALITY_REPORT_UNTRUSTED');
    if (check.status === 'PASS' && (!Array.isArray(check.artifacts) || !check.artifacts.length)) {
      throw new Error('QUALITY_REPORT_METRICS_MISSING');
    }
  }
  const artifacts = report.checks.flatMap(check => check.artifacts ?? []);
  if (JSON.stringify(artifacts) !== JSON.stringify(report.artifacts)) throw new Error('QUALITY_REPORT_UNTRUSTED');
  return report;
}

function blockedAfterExecution(project, tier, sourceDigest, reasonCode, execution, attemptId = null) {
  let receipt;
  try {
    receipt = persistQualityReceipt(project, { tier, status: 'BLOCKED', sourceDigest, reasonCode, attemptId,
      checks: [{ name: 'quality-executor', status: 'BLOCKED', reasonCode,
        observed: false, exitCode: null }],
      report: { schemaVersion: 1, tier, sourceDigest, reasonCode, execution: {
        code: execution?.code ?? null, transcriptSha256: execution?.transcriptSha256 ?? null,
        eventCount: execution?.eventCount ?? null } } });
  } catch (error) {
    return { mode: 'quality-check', status: error.message === 'QUALITY_SOURCE_CHANGED' ? 'STALE' : 'BLOCKED',
      project, tier, reasonCode: error.message, writes: [] };
  }
  return { mode: 'quality-check', status: 'BLOCKED', project, tier,
    reasonCode, qualityRunId: receipt.qualityRunId, receiptDigest: receipt.receiptDigest };
}

export function executeQualityCheck(plan, { apply = false, executor } = {}) {
  if (plan?.mode !== 'quality-check') throw new Error('QUALITY_PLAN_INVALID');
  if (!apply || plan.status !== 'READY') return plan;
  const fresh = planQualityCheck(plan.project, { tier: plan.tier });
  if (fresh.status !== 'READY' || fresh.fingerprint !== plan.fingerprint) {
    return { mode: 'quality-check', project: plan.project, tier: plan.tier,
      status: 'BLOCKED', reasonCode: fresh.reasonCode ?? 'QUALITY_PLAN_STALE',
      conflicts: fresh.conflicts ?? ['QUALITY_PLAN_STALE'], writes: [] };
  }
  const policy = readQualityPolicy(plan.project);
  const source = inspectNativeProject(plan.project);
  const attemptId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const relative = `.ludory/quality/attempts/${attemptId}`;
  try {
    safeQualityDirectory(plan.project, relative, true);
    const runnerBytes = fs.readFileSync(RUNNER);
    const request = { schemaVersion: 1, tier: plan.tier, sourceDigest: plan.sourceDigest,
      policyDigest: plan.policyDigest, tools: policy.tools };
    const requestBytes = Buffer.from(`${JSON.stringify(request)}\n`);
    fs.writeFileSync(safeQualityFile(plan.project, `${relative}/quality.test.mjs`, { required: false }),
      runnerBytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(safeQualityFile(plan.project, `${relative}/request.json`, { required: false }),
      requestBytes, { flag: 'wx', mode: 0o600 });
    const requiredCommand = `node --test ${relative}/quality.test.mjs`;
    const prepared = prepareCodexExecution(plan.project, {
      target: 'Run the prescribed Engineering Quality command without modifying game source.',
      inScope: [relative], outOfScope: ['src', 'ludory.project.json', '.ludory/ai'],
      acceptanceContract: 'Execute the exact command and let its evidence be independently inspected.',
      mutationBoundary: `Write only ${relative}/report.json. Do not modify sources or policy.`,
    }, 'ENGINEERING_QUALITY', { gitRoot: source.gitRoot, requiredCommand });
    const impl = executor ?? { check: checkCodexAvailable, run: runCodexExecution };
    if (!impl.check(prepared).ok) return blockedAfterExecution(plan.project, plan.tier,
      plan.sourceDigest, 'QUALITY_EXECUTOR_UNAVAILABLE', null, attemptId);
    // Availability probes can run arbitrary host code. Recheck the independent
    // Studio pin before launching Codex; never journal a successful execution
    // for a game whose trusted origin was revoked while probing.
    const origin = verifyStudioOrigin(plan.project);
    if (!origin.ok) return { mode: 'quality-check', project: plan.project, tier: plan.tier,
      status: 'BLOCKED', reasonCode: `QUALITY_${origin.code}`,
      writes: [`${relative}/quality.test.mjs`, `${relative}/request.json`] };
    const execution = impl.run(prepared);
    if (!execution?.ok || execution.code !== 'EXECUTED_UNVERIFIED') return blockedAfterExecution(
      plan.project, plan.tier, plan.sourceDigest, 'QUALITY_EXECUTION_UNVERIFIED', execution, attemptId);
    if (qualityDigest(fs.readFileSync(safeQualityFile(plan.project, `${relative}/quality.test.mjs`))) !==
        qualityDigest(runnerBytes) || snapshotQualitySource(plan.project).digest !== plan.sourceDigest) {
      return { mode: 'quality-check', project: plan.project, tier: plan.tier,
        status: 'STALE', reasonCode: 'QUALITY_SOURCE_OR_RUNNER_CHANGED' };
    }
    for (const name of CHECK_NAMES[plan.tier].filter(name => name !== 'tests')) {
      if (checkedTool(name, policy.tools[name])) return blockedAfterExecution(plan.project, plan.tier,
        plan.sourceDigest, 'QUALITY_TOOL_CHANGED', execution, attemptId);
    }
    const report = checkedReport(plan.project, `${relative}/report.json`, qualityDigest(requestBytes),
      plan.tier, plan.sourceDigest, policy.tools);
    const status = report.checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED'
      : report.checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS';
    const reasonCode = report.checks.find(check => check.status !== 'PASS')?.reasonCode ?? null;
    const receipt = persistQualityReceipt(plan.project, { tier: plan.tier, status, reasonCode,
      checks: report.checks, report, sourceDigest: plan.sourceDigest,
      policyDigest: plan.policyDigest, attemptId });
    return { mode: 'quality-check', status, project: plan.project, tier: plan.tier, reasonCode,
      qualityRunId: receipt.qualityRunId, receiptDigest: receipt.receiptDigest };
  } catch (error) {
    return blockedAfterExecution(plan.project, plan.tier, plan.sourceDigest,
      error.message === 'QUALITY_SOURCE_CHANGED' ? 'QUALITY_SOURCE_CHANGED' : 'QUALITY_REPORT_UNTRUSTED', null, attemptId);
  }
}
