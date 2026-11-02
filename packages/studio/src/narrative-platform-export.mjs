import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalPhysicalDirectory } from '@ludory/core';
import { verifyStudioOrigin, assertComponentTrust, hostTrustDigest } from '@ludory/studio-trust';
import { readRegular } from './profile-state.mjs';
import { planPreviewBuild, buildPreview } from './preview-build.mjs';

const mode = 'narrative-platform-export';
const targets = Object.freeze(['yandex-games', 'vk-games']);
const issuedPlans = new WeakMap();

function blocked(project, reasonCode) {
  return { mode, project, status: 'BLOCKED', reasonCode, writes: [] };
}

function sourceIdentity(project) {
  const origin = verifyStudioOrigin(project);
  if (!origin.ok || origin.project !== project) throw new Error(`F5B_STUDIO_ORIGIN_${origin.code}`);
  const receipt = readRegular(path.join(project, 'ludory.studio.json'), 'ludory.studio.json');
  const state = readRegular(path.join(project, 'ludory.components.json'), 'ludory.components.json');
  const sourceManifest = readRegular(path.join(project, 'ludory.project.json'), 'ludory.project.json');
  const rootStat = fs.lstatSync(project, { bigint: true });
  assertComponentTrust(project, { rootIdentity: `${rootStat.dev}:${rootStat.ino}`,
    receiptSha256: hostTrustDigest(receipt), stateSha256: hostTrustDigest(state),
    manifestSha256: hostTrustDigest(sourceManifest) });
  const studio = JSON.parse(receipt.toString('utf8'));
  const components = JSON.parse(state.toString('utf8'));
  const manifest = JSON.parse(sourceManifest.toString('utf8'));
  if (studio.profile?.id !== 'narrative-game' || studio.template?.id !== 'narrative-interactive' ||
      components.template?.id !== 'narrative-interactive' ||
      components.template?.profile !== 'narrative-game') {
    throw new Error('F5B_NARRATIVE_TEMPLATE_REQUIRED');
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length !== 2 ||
      !targets.every(target => manifest.targets.includes(target))) {
    throw new Error('F5B_DUAL_TARGET_DECLARATION_REQUIRED');
  }
  return manifest;
}

function shape(plan) {
  return JSON.stringify({ mode: plan.mode, status: plan.status, project: plan.project,
    sourceDigest: plan.sourceDigest, sourcePlanId: plan.sourcePlanId,
    files: plan.files, targets: plan.targets, writes: plan.writes });
}

/** Read-only permission to derive two platform builds from one original Studio narrative. */
export function planNarrativePlatformExport(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    return blocked(null, 'F5B_PROJECT_PATH_REQUIRED');
  }
  const requested = path.resolve(projectDir);
  let project = requested;
  try {
    project = canonicalPhysicalDirectory(requested);
    const preview = planPreviewBuild(project);
    if (preview.status !== 'READY') throw new Error(preview.reasonCode);
    sourceIdentity(project);
    // Protect against a metadata/manifest race between the provenance read and the preview scan.
    const repeated = planPreviewBuild(project);
    if (repeated.status !== 'READY' || repeated.sourceDigest !== preview.sourceDigest ||
        repeated.rootIdentity !== preview.rootIdentity ||
        JSON.stringify(repeated.files) !== JSON.stringify(preview.files)) {
      throw new Error('F5B_SOURCE_CHANGED');
    }
    const result = { mode, status: 'READY_TO_DERIVE', project, sourceDigest: preview.sourceDigest,
      sourcePlanId: randomUUID(), files: preview.files.map(file => ({ ...file })),
      targets: [...targets], writes: [] };
    issuedPlans.set(result, { shape: shape(result), preview });
    return result;
  } catch (error) { return blocked(project, error.message || 'F5B_SOURCE_UNAVAILABLE'); }
}

/** Pins real source bytes only; the future SDK packaging step must build and verify its own outputs. */
export function materializeNarrativePlatformSource(plan) {
  const issued = plan && typeof plan === 'object' ? issuedPlans.get(plan) : null;
  if (!issued || shape(plan) !== issued.shape) {
    return blocked(plan?.project ?? null, 'F5B_EXPORT_PLAN_UNTRUSTED');
  }
  const built = buildPreview(issued.preview);
  if (built.status !== 'BUILT') return blocked(issued.preview.project, built.reasonCode);
  if (built.sourceDigest !== plan.sourceDigest ||
      JSON.stringify(built.files) !== JSON.stringify(plan.files)) {
    built.cleanup();
    return blocked(plan.project, 'F5B_SOURCE_CHANGED');
  }
  return { mode, status: 'SOURCE_PINNED', root: built.root, sourceDigest: built.sourceDigest,
    files: built.files, targets: [...targets], cleanup: built.cleanup,
    releaseReady: false, publicationAllowed: false };
}
