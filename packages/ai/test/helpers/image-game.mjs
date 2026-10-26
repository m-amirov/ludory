import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeProject } from './project.mjs';
import { planNewRun, commitNewRun } from '../../src/store.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function game(t, studio = true) {
  const project = nativeProject(t);
  if (studio) fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'narrative-game' }, template: { id: 'starter' },
    files: { 'ludory.project.json': sha(fs.readFileSync(path.join(project, 'ludory.project.json'))) },
  }));
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'Scene: lighthouse over a winter sea.');
  const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'Scene art', inScope: ['image-brief.md'], outOfScope: [],
    acceptanceContract: 'Independent visual review', mutationBoundary: 'Review-only images',
  } })).run.runId;
  return { project, run };
}
