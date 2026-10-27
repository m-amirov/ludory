import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installVendoredDevHelper, readVendoredHelperManifest, verifyHelperArtifact } from '../src/helper-supply.mjs';
import { discoverDevHost } from '../src/dev-host.mjs';

function profileFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-helper-supply-'));
  const home = path.join(root, 'dev');
  const stableHome = path.join(root, 'stable');
  const runtime = path.join(home, 'runtime');
  const launcher = path.join(root, 'launcher',
    process.platform === 'win32' ? 'Codex Web GPT.exe' : 'codex-web-gpt');
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.copyFileSync(process.execPath, launcher);
  const descriptorPath = path.join(runtime, 'launcher-browser.json');
  fs.writeFileSync(descriptorPath, JSON.stringify({
    profile: 'development', kind: 'codex-web-gpt-launcher',
    helper: { executable: launcher, script: path.join(runtime, 'old-helper.cjs') },
  }));
  fs.writeFileSync(path.join(runtime, 'old-helper.cjs'), 'module.exports = {}.\n');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    version: 3, releaseVersion: '6.1.11', mode: 'browser-only',
    browserHostDescriptorPath: descriptorPath,
  }));
  for (const packageInfo of readVendoredHelperManifest().runtime.requiredPackages) {
    const packageDirectory = path.join(runtime, 'node_modules', ...packageInfo.name.split('/'));
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify(packageInfo));
  }
  fs.mkdirSync(stableHome, { recursive: true });
  return { root, home, stableHome, runtime, descriptorPath, launcher };
}

test('vendored manifest pins the patched v2 artifact and source provenance', () => {
  const manifest = readVendoredHelperManifest();
  assert.equal(manifest.artifact.sha256, 'c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7');
  assert.equal(manifest.artifact.bytes, 216615);
  assert.equal(manifest.artifact.label, 'codex-chatgpt-web-6.1.14-patched-browser-observation-v2');
  assert.deepEqual(manifest.upstream.commits, ['83135a5', 'a8199d9']);
  assert.deepEqual(manifest.protocol.features, ['browser_observation_v2']);
  assert.equal(manifest.build.byteReproducible, false);
  assert.equal(verifyHelperArtifact({
    scriptFile: path.resolve('packages/ai/vendor/codex-chatgpt-web/browser-helper.cjs'),
    manifestFile: path.resolve('packages/ai/vendor/codex-chatgpt-web/manifest.json'),
  }).sha256, manifest.artifact.sha256);
});

test('installer writes only the isolated DEV profile and fails closed after replacement', async t => {
  const fixture = profileFixture();
  const previousLauncher = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.launcher;
  t.after(() => {
    if (previousLauncher === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousLauncher;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  const preview = installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(preview.status, 'READY');
  assert.ok(preview.writes.every(file => {
    const relative = path.relative(fixture.home, file);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }));
  assert.equal(fs.existsSync(path.join(fixture.stableHome, 'browser-helper.cjs')), false);

  const applied = installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome, apply: true });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.installed.sha256, preview.artifact.sha256);
  const installedExecutable = JSON.parse(fs.readFileSync(fixture.descriptorPath, 'utf8')).helper.executable;
  assert.equal(installedExecutable, fs.realpathSync.native(fixture.launcher));
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.home, 'config.json'), 'utf8')).browserHelperScriptPath,
    path.join(fixture.runtime, 'browser-helper.cjs'));
  const installedHost = discoverDevHost({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(installedHost.available, false);
  assert.equal(installedHost.descriptor.helper.script, path.join(fixture.runtime, 'browser-helper.cjs'));
  await installedHost.close();

  fs.appendFileSync(path.join(fixture.runtime, 'browser-helper.cjs'), 'replacement');
  const blocked = discoverDevHost({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(blocked.reasonCode, 'DEV_HELPER_HASH_MISMATCH');
});

test('installer blocks when a pinned helper runtime package is missing', t => {
  const fixture = profileFixture();
  const previousLauncher = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.launcher;
  t.after(() => {
    if (previousLauncher === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousLauncher;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  fs.rmSync(path.join(fixture.runtime, 'node_modules', 'zod'), { recursive: true, force: true });
  assert.throws(() => installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome }),
    /DEV_HELPER_RUNTIME_UNAVAILABLE/);
});
