import fs from 'node:fs';
import path from 'node:path';
import { nativeProject, newStudioAiProject } from './project.mjs';
import { planNewRun, commitNewRun } from '../../src/store.mjs';

export function game(t, studio = true) {
  const project = studio ? newStudioAiProject(t) : nativeProject(t);
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'Scene: lighthouse over a winter sea.');
  const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'Scene art', inScope: ['image-brief.md'], outOfScope: [],
    acceptanceContract: 'Independent visual review', mutationBoundary: 'Review-only images',
  } })).run.runId;
  return { project, run };
}
