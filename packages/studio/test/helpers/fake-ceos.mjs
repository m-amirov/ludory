import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Real child-process fixture: all captured values come from child argv/cwd. */
export function fakeCeos(t, { version = '0.5.40', packageName = 'codex-engineering-os', exitCode = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-fake-ceos-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: packageName, version, type: 'module' }));
  fs.writeFileSync(path.join(root, 'VERSION'), `${version}\n`);
  const entry = path.join(root, 'bin', 'ceos.mjs');
  fs.writeFileSync(entry, `import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const configuredExit = ${exitCode};
if (a.includes('--invalid-json')) { process.stdout.write('invalid\\n'); process.exit(0); }
if (a.includes('--oversize')) { process.stdout.write('x'.repeat(2_200_000)); process.exit(0); }
if (a.includes('--hang')) { while (true) {} }
const command = a[0];
const guided = command === 'continue' && a.includes('guided');
if (command === 'run' || command === 'checkpoint' || guided) {
  fs.appendFileSync(path.join(process.cwd(), 'fake-ceos-actions.txt'), command + '\\n');
}
console.log(JSON.stringify({ command, argv: a, cwd: process.cwd(), status: configuredExit === 2 || a.includes('--blocked') ? 'BLOCKED' : configuredExit === 3 ? 'ESCALATE' : 'READY_FOR_CODEX', simulated: true }));
process.exit(a.includes('--blocked') ? 2 : a.includes('--escalate') ? 3 : configuredExit);
`);
  return { root, entry };
}

export function fakeProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-workflow-game-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'ludory.project.json'), `${JSON.stringify({
    schemaVersion: 1, id: 'workflow-game', version: '0.1.0',
    title: { en: 'Workflow Game' }, engine: 'web', targets: ['vk-games', 'yandex-games'],
  })}\n`);
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '/* USER OWNED GAME */\n');
  return project;
}
