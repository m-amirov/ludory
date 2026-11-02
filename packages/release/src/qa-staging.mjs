import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectCandidateForQaStaging, SHA_256, sha256 } from './archive.mjs';
import { ReleaseInputError } from './errors.mjs';

function ownedDirectory(root, identity) {
  let current;
  try { current = fs.lstatSync(root, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!current.isDirectory() || current.isSymbolicLink() ||
      current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new ReleaseInputError('QA_STAGING_OWNERSHIP_CHANGED',
      'QA staging directory was replaced; refusing recursive cleanup');
  }
  return true;
}

/**
 * Materialize a verified, bounded C5/V5 stored ZIP as inert file bytes.
 * DOES NOT run JavaScript, start a server, or grant browser isolation.
 * The caller must independently enforce an OS-level sandbox before execution.
 */
export function stageQaCandidate({ target, archivePath, candidateSha256 } = {}) {
  if (typeof candidateSha256 !== 'string' || !SHA_256.test(candidateSha256)) {
    throw new ReleaseInputError('QA_CANDIDATE_SHA_INVALID', 'A verified candidate SHA-256 is required');
  }
  // The existing Release parser validates stored ZIP format, CRCs, canonical
  // paths, file sizes and the target-specific contents before any filesystem write.
  const snapshot = inspectCandidateForQaStaging(archivePath, target);
  if (snapshot.sha256 !== candidateSha256) {
    throw new ReleaseInputError('QA_CANDIDATE_SHA_MISMATCH', 'Candidate changed after QA verification');
  }

  let root;
  let identity;
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-stage-'));
    fs.chmodSync(root, 0o700);
    identity = fs.lstatSync(root, { bigint: true });
    for (const file of snapshot.files) {
      const content = snapshot.fileContents.get(file.path);
      if (!content || content.length !== file.size || sha256(content) !== file.sha256) {
        throw new ReleaseInputError('QA_STAGING_DIGEST_MISMATCH', 'Verified ZIP member differs from inventory');
      }
      const destination = path.join(root, ...file.path.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, content, { flag: 'wx', mode: 0o600 });
      // Explicitly re-verify the materialized bytes, not just the ZIP map.
      const materialized = fs.readFileSync(destination);
      if (materialized.length !== file.size || sha256(materialized) !== file.sha256) {
        throw new ReleaseInputError('QA_STAGING_DIGEST_MISMATCH', 'Staged file differs from ZIP member');
      }
    }
    // The inventory is immutable input for subsequent QA. It does not attest
    // the sandbox, the displayed pixels, or browser execution.
    const files = snapshot.files.map(file => Object.freeze({ ...file }));
    let cleaned = false;
    return {
      root, candidateSha256, target, files: Object.freeze(files),
      cleanup() {
        if (cleaned) return;
        if (ownedDirectory(root, identity)) fs.rmSync(root, { recursive: true });
        cleaned = true;
      },
    };
  } catch (error) {
    if (root && identity && ownedDirectory(root, identity)) {
      fs.rmSync(root, { recursive: true });
    }
    throw error;
  }
}
