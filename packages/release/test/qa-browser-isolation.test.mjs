import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeQaDockerIsolation, planQaDockerInvocation } from '../src/qa-browser-isolation.mjs';

const imageRef = 'ghcr.io/example/ludory-qa-runner@sha256:' + 'a'.repeat(64);
const ok = stdout => ({ status: 0, stdout: JSON.stringify(stdout) });
const responses = {
  'info': ['name=seccomp,profile=builtin', 'name=rootless'],
  'digest': [imageRef],
  'os': 'linux',
};
function mockDocker(file, args) {
  assert.equal(file, 'docker');
  if (args[0] === 'info') return ok(responses.info);
  if (args[2] === imageRef && args.at(-1).includes('RepoDigests')) return ok(responses.digest);
  if (args[2] === imageRef && args.at(-1).includes('.Os')) return ok(responses.os);
  return { status: 1, stdout: '' };
}

test('P3b Docker preflight requires local digest, rootless seccomp and no image pull', () => {
  const proof = probeQaDockerIsolation({ imageRef, platform: 'linux', execute: mockDocker });
  assert.equal(proof.status, 'CAPABILITY_CONFIRMED');
  assert.equal(proof.browserExecuted, false);
  assert.equal(proof.network, 'none');
  assert.equal(proof.imagePulled, false);
  assert.equal(probeQaDockerIsolation({ imageRef, platform: 'win32', execute: mockDocker }).status, 'BLOCKED');
  assert.equal(probeQaDockerIsolation({ imageRef: 'playwright:latest', platform: 'linux', execute: mockDocker }).reasonCode,
    'QA_BROWSER_IMAGE_DIGEST_REQUIRED');
});

test('P3b Docker preflight blocks unavailable image or rootful/unenforced seccomp', () => {
  const rootful = (file, args) => args[0] === 'info' ? ok(['name=seccomp,profile=builtin']) : mockDocker(file, args);
  assert.equal(probeQaDockerIsolation({ imageRef, platform: 'linux', execute: rootful }).reasonCode,
    'QA_BROWSER_ROOTLESS_SECCOMP_REQUIRED');
  const unconfined = (file, args) => args[0] === 'info'
    ? ok(['name=rootless', 'name=seccomp,profile=unconfined']) : mockDocker(file, args);
  assert.equal(probeQaDockerIsolation({ imageRef, platform: 'linux', execute: unconfined }).status, 'BLOCKED');
  const missing = (file, args) => args.at(-1)?.includes('RepoDigests') ? ok([]) : mockDocker(file, args);
  assert.equal(probeQaDockerIsolation({ imageRef, platform: 'linux', execute: missing }).reasonCode,
    'QA_BROWSER_IMAGE_NOT_PINNED_LOCALLY');
  const crash = () => { throw new Error('docker is unavailable'); };
  assert.equal(probeQaDockerIsolation({ imageRef, platform: 'linux', execute: crash }).status, 'BLOCKED');
});

test('P3b sandbox invocation excludes workspace, credentials, networking, privilege and image pulls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = { root, target: 'vk-games', candidateSha256: 'b'.repeat(64) };
  const capability = probeQaDockerIsolation({ imageRef, platform: 'linux', execute: mockDocker });
  const result = planQaDockerInvocation({ stage, imageRef, capability });
  if (process.platform !== 'linux') {
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reasonCode, 'QA_BROWSER_LINUX_ISOLATION_REQUIRED');
    return;
  }
  assert.equal(result.status, 'INVOCATION_PLANNED');
  assert.equal(result.browserExecuted, false);
  const cmd = result.args.join(' ');
  assert.match(cmd, /--network=none/);
  assert.match(cmd, /--read-only/);
  assert.match(cmd, /--cap-drop=ALL/);
  assert.match(cmd, /--security-opt=no-new-privileges/);
  assert.match(cmd, /--pull=never/);
  assert.match(cmd, /dst=\/candidate,readonly/);
  assert.doesNotMatch(cmd, /--privileged|--network=host|\/var\/run\/docker\.sock|\/home\/|--env-file/);
  assert.deepEqual(result.args.slice(-5), [imageRef, '--candidate-sha256', stage.candidateSha256, '--target', stage.target]);
  assert.equal(planQaDockerInvocation({ stage, imageRef, capability: null }).status, 'BLOCKED');
  assert.equal(planQaDockerInvocation({ stage, imageRef, capability: { ...capability } }).reasonCode,
    'QA_BROWSER_ISOLATION_UNAVAILABLE', 'JSON-copied proof must be rejected');
  assert.equal(planQaDockerInvocation({ stage: { ...stage, root: root + '-missing' }, imageRef, capability }).status, 'BLOCKED');
  assert.equal(planQaDockerInvocation({ stage, imageRef: imageRef.replace('a'.repeat(64), 'c'.repeat(64)), capability }).status,
    'BLOCKED');
});

test('P3b staging path is never an arbitrary host directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capability = probeQaDockerIsolation({ imageRef, platform: 'linux', execute: mockDocker });
  const stage = { root: os.homedir(), target: 'yandex-games', candidateSha256: 'c'.repeat(64) };
  assert.equal(planQaDockerInvocation({ stage, imageRef, capability }).reasonCode, 'QA_BROWSER_STAGING_PATH_UNSAFE');
  assert.equal(planQaDockerInvocation({ stage: { ...stage, root }, imageRef, capability }).status,
    process.platform === 'linux' ? 'INVOCATION_PLANNED' : 'BLOCKED');
});
