import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';

export function runGit(project, ...args) {
  const result = spawnSync('git', args, { cwd: project, encoding: 'utf8', timeout: 5_000 });
  if (result.status !== 0) throw new Error(`Git ${args.join(' ')}: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

export function nativeProject(t) {
  const project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-native-ai-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'ludory.project.json'), `${JSON.stringify({
    schemaVersion: 1, id: 'native-game', version: '0.1.0', title: { en: 'Native Game' },
    engine: 'web', targets: ['yandex-games', 'vk-games'],
  })}\n`);
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// Original user code\n');
  runGit(project, 'init', '-b', 'main');
  runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'add', '.');
  runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline');
  return project;
}

/** A genuinely registered Studio game, unlike nativeProject's intentionally foreign fixture. */
export function newStudioAiProject(t, { git = true } = {}) {
  const project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-studio-ai-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const planned = planCreate(project, {
    id: 'native-game', title: 'Native Game', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games', 'vk-games'],
  });
  if (planned.status !== 'READY') throw new Error(`Test Studio create blocked: ${planned.conflicts.join('; ')}`);
  const created = applyCreatePlan(planned);
  if (created.status !== 'APPLIED') throw new Error(`Test Studio create not applied: ${created.status}`);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// Original user code\n');
  if (git) {
    runGit(project, 'init', '-b', 'main');
    runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'add', '.');
    runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline');
  }
  return project;
}
