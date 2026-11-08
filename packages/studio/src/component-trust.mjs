// Preserve the Studio module boundary while sharing one host trust authority with AI.
export { assertComponentTrust, registerComponentTrust, advanceComponentTrust,
  hostTrustDigest, isMissingHostTrust, verifyStudioOrigin,
  componentHostRegistryBinding } from '@ludory/studio-trust';

import { registerComponentRecoveryCheckpoint as registerRecovery,
  readComponentRecoveryCheckpoint as readRecovery } from '@ludory/studio-trust';
import { openProtectedDirectory } from './windows-directory-pin.mjs';

const nativeRecoveryOptions = () => process.platform === 'win32'
  ? { windowsPin: openProtectedDirectory } : {};

export function registerComponentRecoveryCheckpoint(project, details, expectedBinding) {
  return registerRecovery(project, details, expectedBinding, nativeRecoveryOptions());
}

export function readComponentRecoveryCheckpoint(project) {
  return readRecovery(project, nativeRecoveryOptions());
}

export function assertComponentRecoveryCheckpoint(project, expected) {
  const checkpoint = readComponentRecoveryCheckpoint(project);
  if (!checkpoint) {
    throw Object.assign(new Error('No owner-approved component recovery checkpoint'), { code: 'TRUST_MISSING' });
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!Object.hasOwn(checkpoint, key) || checkpoint[key] !== value) {
      throw Object.assign(new Error(`Component recovery checkpoint ${key} differs from expected state`),
        { code: 'TRUST_CONFLICT' });
    }
  }
  return checkpoint;
}
