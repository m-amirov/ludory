import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SHA_256 } from './archive.mjs';

const imagePattern = /^([a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+)@sha256:([a-f0-9]{64})$/;
const block = reasonCode => Object.freeze({ status: 'BLOCKED', reasonCode });
const fixedRunner = '/usr/local/bin/ludory-qa-runner';
// Only objects produced by this module's successful local probe can plan a run.
const probedCapabilities = new WeakSet();

/** A security preflight, NOT an attestation that a browser ran or that screenshots exist.
 * No Docker pulls, containers, network requests or game execution happen here. */
export function probeQaDockerIsolation({ imageRef, platform = process.platform,
  execute = (file, args) => spawnSync(file, args, { encoding: 'utf8',
    timeout: 5000, maxBuffer: 65536, windowsHide: true }) } = {}) {
  if (platform !== 'linux') return block('QA_BROWSER_LINUX_ISOLATION_REQUIRED');
  if (typeof imageRef !== 'string' || !imagePattern.test(imageRef)) {
    return block('QA_BROWSER_IMAGE_DIGEST_REQUIRED');
  }
  const check = args => {
    let result;
    try { result = execute('docker', args); }
    catch { return null; }
    if (result?.status !== 0 || result.error || typeof result.stdout !== 'string' ||
        result.stdout.length > 65536) return null;
    try { return JSON.parse(result.stdout); }
    catch { return null; }
  };
  // A rootful Docker daemon or unrestricted user daemon socket is not a
  // substitute for isolating untrusted game JS from the host.
  const security = check(['info', '--format', '{{json .SecurityOptions}}']);
  if (!Array.isArray(security) || !security.includes('name=rootless') ||
      !security.some(value => /^name=seccomp(?:,|$)/.test(value) && !value.includes('unconfined'))) {
    return block('QA_BROWSER_ROOTLESS_SECCOMP_REQUIRED');
  }
  const digests = check(['image', 'inspect', imageRef, '--format', '{{json .RepoDigests}}']);
  if (!Array.isArray(digests) || !digests.includes(imageRef)) {
    return block('QA_BROWSER_IMAGE_NOT_PINNED_LOCALLY');
  }
  const osName = check(['image', 'inspect', imageRef, '--format', '{{json .Os}}']);
  if (osName !== 'linux') return block('QA_BROWSER_IMAGE_PLATFORM_INVALID');
  const capability = Object.freeze({ status: 'CAPABILITY_CONFIRMED', isolation: 'ROOTLESS_DOCKER',
    imageRef, network: 'none', imagePulled: false, browserExecuted: false });
  probedCapabilities.add(capability);
  return capability;
}

/** Prepare an immutable, security-restricted invocation for the future P3b
 * runner image. The caller must pass a stageQaCandidate() result, never a
 * game source directory. Does not spawn Docker or run browser code. */
export function planQaDockerInvocation({ stage, imageRef, capability } = {}) {
  if (!capability || !probedCapabilities.has(capability) ||
      capability?.status !== 'CAPABILITY_CONFIRMED' ||
      capability.imageRef !== imageRef || capability.isolation !== 'ROOTLESS_DOCKER') {
    return block('QA_BROWSER_ISOLATION_UNAVAILABLE');
  }
  if (typeof stage?.root !== 'string' || !SHA_256.test(stage.candidateSha256 ?? '') ||
      !['yandex-games', 'vk-games'].includes(stage.target)) {
    return block('QA_BROWSER_STAGING_REQUIRED');
  }
  let real, temp;
  try {
    real = fs.realpathSync(stage.root);
    temp = fs.realpathSync(os.tmpdir());
    const stat = fs.lstatSync(real);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(real) !== temp ||
        !path.basename(real).startsWith('ludory-qa-stage-') || /[,\r\n\0]/.test(real)) {
      return block('QA_BROWSER_STAGING_PATH_UNSAFE');
    }
  } catch { return block('QA_BROWSER_STAGING_PATH_UNSAFE'); }
  if (real !== stage.root) return block('QA_BROWSER_STAGING_PATH_UNSAFE');
  const args = Object.freeze([
    'run', '--rm', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit=64', '--memory=768m', '--cpus=1',
    '--user=0:0', '--tmpfs=/tmp:rw,nosuid,nodev,size=128m',
    '--mount', `type=bind,src=${real},dst=/candidate,readonly`,
    '--workdir=/candidate', '--entrypoint', fixedRunner,
    imageRef, '--candidate-sha256', stage.candidateSha256, '--target', stage.target,
  ]);
  return Object.freeze({ status: 'INVOCATION_PLANNED', command: 'docker', args,
    candidateSha256: stage.candidateSha256, target: stage.target,
    browserExecuted: false, network: 'none', outputEvidence: null });
}
