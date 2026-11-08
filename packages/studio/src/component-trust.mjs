// Preserve the Studio module boundary while sharing one host trust authority with AI.
export { assertComponentTrust, registerComponentTrust, advanceComponentTrust,
  hostTrustDigest, isMissingHostTrust, verifyStudioOrigin,
  registerComponentRecoveryCheckpoint, readComponentRecoveryCheckpoint,
  assertComponentRecoveryCheckpoint, componentHostRegistryBinding } from '@ludory/studio-trust';
