import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCli } from '../../src/cli.mjs';
import { readNativeRun } from '../../../ai/src/store.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** Local-contract-only fixture. Deliberately never permits a DEV helper or paid tool call. */
export async function runFreshAiFixture(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f1-ai-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const project = path.join(sandbox, 'fresh-game');
  const foreign = path.join(sandbox, 'owner-foreign-tree');
  fs.mkdirSync(project);
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'owner-data.txt'), 'owner data\n');
  fs.writeFileSync(path.join(foreign, 'ludory.project.json'), `${JSON.stringify({
    schemaVersion: 1, id: 'frozen-legacy-game', version: '0.1.0', title: { en: 'Frozen Game' },
    engine: 'web', targets: ['yandex-games'],
  })}\n`);
  const foreignDigest = () => sha(Buffer.from(fs.readdirSync(foreign).sort().map(file =>
    `${file}:${sha(fs.readFileSync(path.join(foreign, file)))}`).join('\n')));
  const foreignHashBefore = foreignDigest();
  const commands = [];
  let hostInvocations = 0;

  async function cli(...args) {
    let stdout = '', stderr = '';
    const status = await runCli(args, { out: text => { stdout += text; },
      err: text => { stderr += text; }, devHost: () => {
        hostInvocations++;
        throw new Error('F1_FIXTURE_MUST_NOT_INVOKE_EXTERNAL_HOST');
      } });
    let result;
    try { result = JSON.parse(stdout); }
    catch { throw new Error(`Fixture CLI ${args.join(' ')} returned ${status}: ${stderr || stdout}`); }
    commands.push({ args, exitCode: status, status: result.status,
      reasonCode: result.reasonCode ?? null });
    return result;
  }

  const create = await cli('create', '--project', project, '--id', 'f1-native-ai',
    '--title', 'F1 Native AI', '--lang', 'en', '--profile', 'web-game',
    '--template', 'web-basic', '--targets', 'yandex-games', '--apply', '--json');
  fs.writeFileSync(path.join(project, 'scene-brief.md'),
    'Illustrate an Icelandic lighthouse at sunset for an original visual novel.');
  const doctor = await cli('workflow', 'doctor', '--project', project, '--json');
  const frozenRoute = await cli('workflow', 'route', '--project', foreign,
    '--task', 'episode-script', '--json');
  const routeEpisode = await cli('workflow', 'route', '--project', project,
    '--task', 'episode-script', '--json');
  const routeImage = await cli('workflow', 'route', '--project', project,
    '--task', 'image', '--json');
  const startArgs = ['workflow', 'start', '--project', project,
    '--pipeline', 'production-art', '--target', 'F1 Scene', '--in-scope', 'scene-brief.md',
    '--acceptance', 'owner-visible source-bound receipts',
    '--mutation-boundary', 'new fixture only', '--json'];
  const startPreview = await cli(...startArgs);
  const previewRunCreated = fs.existsSync(path.join(project, '.ludory', 'ai', 'runs'));
  const startApplied = await cli(...startArgs, '--apply');
  const run = startApplied.runId;
  const status = await cli('workflow', 'status', '--project', project, '--run', run, '--json');
  const next = await cli('workflow', 'next', '--project', project, '--run', run, '--json');
  const continuePreview = await cli('workflow', 'continue', '--project', project,
    '--run', run, '--json');
  const image = await cli('workflow', 'image', '--project', project, '--run', run,
    '--brief', 'scene-brief.md', '--json');
  const imageApply = await cli('workflow', 'image', '--project', project, '--run', run,
    '--brief', 'scene-brief.md', '--apply', '--json');
  const draft = await cli('workflow', 'draft', '--project', project, '--run', run,
    '--task', 'episode-script', '--brief', 'scene-brief.md', '--json');
  const narrative = await cli('workflow', 'narrative-review', '--project', project,
    '--run', run, '--json');
  const art = await cli('workflow', 'art-review', '--project', project,
    '--run', run, '--image', 'candidate.png', '--json');
  const recover = await cli('workflow', 'recover', '--project', project,
    '--run', run, '--json');
  const quality = await cli('quality', 'status', '--project', project, '--json');
  return { project, foreign, run, create, doctor, frozenRoute, routeEpisode, routeImage,
    startPreview, previewRunCreated, startApplied, status, next, continuePreview, image, imageApply, draft,
    narrative, art, recover, quality, commands, hostInvocations,
    eventsAfterHandoffs: readNativeRun(project, run).events.length,
    foreignHashBefore, foreignHashAfter: foreignDigest() };
}
