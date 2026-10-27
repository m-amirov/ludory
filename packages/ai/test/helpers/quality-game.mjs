import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';

export function qualityGame(t) {
  const project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-quality-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const plan = planCreate(project, { id: 'quality-game', title: 'Quality Game', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games'] });
  if (plan.status !== 'READY') throw new Error(`Fixture plan: ${plan.conflicts}`);
  const applied = applyCreatePlan(plan);
  if (applied.status !== 'APPLIED') throw new Error(`Fixture create: ${applied.conflicts}`);
  return project;
}
