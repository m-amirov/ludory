import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
  assert.equal(manifest.runtime.tree.order, 'utf8-byte-lexicographic');
  assert.ok(manifest.runtime.tree.files > 0);
  assert.ok(manifest.runtime.tree.bytes > 0);
  assert.equal(manifest.runtime.tree.sha256, '3da4d490af2996bb7a04625fe8fa3f76b1fbb0dd72e93fc4533b6e05ee157d20');
  assert.equal(verifyHelperArtifact({
    scriptFile: path.resolve('packages/ai/vendor/codex-chatgpt-web/browser-helper.cjs'),
    manifestFile: path.resolve('packages/ai/vendor/codex-chatgpt-web/manifest.json'),
  }).sha256, manifest.artifact.sha256);
});

test('runtime tree digest is independent of locale comparison order', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-helper-locale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'browser-helper.cjs');
  const manifestFile = path.join(root, 'browser-helper.manifest.json');
  const nodeModules = path.join(root, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(script, 'module.exports = {};\n');
  fs.writeFileSync(path.join(nodeModules, 'ä.txt'), 'umlaut');
  fs.writeFileSync(path.join(nodeModules, 'z.txt'), 'zulu');

  const runtimeEntries = ['ä.txt', 'z.txt'].map(file => {
    const bytes = fs.readFileSync(path.join(nodeModules, file));
    return { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const runtimeDigest = createHash('sha256');
  for (const entry of runtimeEntries) runtimeDigest.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`);
  const helperBytes = fs.readFileSync(script);
  fs.writeFileSync(manifestFile, JSON.stringify({
    schemaVersion: 1,
    distribution: 'test-fixture',
    artifact: { file: path.basename(script), bytes: helperBytes.length,
      sha256: createHash('sha256').update(helperBytes).digest('hex') },
    runtime: { nodeModulesDir: 'node_modules', tree: {
      files: runtimeEntries.length, bytes: runtimeEntries.reduce((sum, entry) => sum + entry.bytes, 0),
      sha256: runtimeDigest.digest('hex'),
    } },
    protocol: { kind: 'compatibility-v1', features: [] },
  }));

  const originalLocaleCompare = String.prototype.localeCompare;
  t.after(() => { String.prototype.localeCompare = originalLocaleCompare; });
  for (const localeOrder of ['umlaut-first', 'z-first']) {
    String.prototype.localeCompare = function localeSensitiveOrder(other, ...args) {
      const left = String(this);
      const right = String(other);
      if ((left === 'ä.txt' && right === 'z.txt') || (left === 'z.txt' && right === 'ä.txt')) {
        const umlautFirst = localeOrder === 'umlaut-first';
        return left === 'ä.txt' ? (umlautFirst ? -1 : 1) : (umlautFirst ? 1 : -1);
      }
      return originalLocaleCompare.call(this, other, ...args);
    };
    assert.doesNotThrow(() => verifyHelperArtifact({ scriptFile: script, manifestFile, checkRuntime: true }), localeOrder);
  }
});

test('v2 rejects a helper and local manifest changed together', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-helper-v2-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'browser-helper.cjs');
  const manifestFile = path.join(root, 'browser-helper.manifest.json');
  fs.copyFileSync(path.resolve('packages/ai/vendor/codex-chatgpt-web/browser-helper.cjs'), script);
  fs.appendFileSync(script, '\n// changed together with the local manifest\n');
  const manifest = structuredClone(readVendoredHelperManifest());
  const bytes = fs.readFileSync(script);
  manifest.artifact.bytes = bytes.length;
  manifest.artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => verifyHelperArtifact({ scriptFile: script, manifestFile, requireTrustedV2: true }),
    /DEV_HELPER_ARTIFACT_UNTRUSTED/);
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
  const canonicalHome = fs.realpathSync.native(fixture.home);
  assert.ok(preview.writes.every(file => {
    const relative = path.relative(canonicalHome, file);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }));
  assert.equal(fs.existsSync(path.join(fixture.stableHome, 'browser-helper.cjs')), false);

  const applied = installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome, apply: true });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.installed.sha256, preview.artifact.sha256);
  const installedExecutable = JSON.parse(fs.readFileSync(fixture.descriptorPath, 'utf8')).helper.executable;
  assert.equal(fs.realpathSync.native(installedExecutable), fs.realpathSync.native(fixture.launcher));
  const installedConfig = JSON.parse(fs.readFileSync(path.join(fixture.home, 'config.json'), 'utf8'));
  assert.equal(fs.realpathSync.native(installedConfig.browserHelperScriptPath),
    fs.realpathSync.native(path.join(fixture.runtime, 'browser-helper.cjs')));
  const installedHost = discoverDevHost({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(installedHost.available, false);
  assert.equal(fs.realpathSync.native(installedHost.descriptor.helper.script),
    fs.realpathSync.native(path.join(fixture.runtime, 'browser-helper.cjs')));
  await installedHost.close();

  fs.appendFileSync(path.join(fixture.runtime, 'browser-helper.cjs'), 'replacement');
  const blocked = discoverDevHost({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(blocked.reasonCode, 'DEV_HELPER_HASH_MISMATCH');
});

test('installed helper blocks when an executable runtime file changes', t => {
  const fixture = profileFixture();
  const previousLauncher = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.launcher;
  t.after(() => {
    if (previousLauncher === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousLauncher;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome, apply: true });
  const executableRuntimeFile = path.join(fixture.runtime, 'node_modules', 'zod', 'index.cjs');
  fs.appendFileSync(executableRuntimeFile, '\n// runtime replacement\n');
  const blocked = discoverDevHost({ devHome: fixture.home, stableHome: fixture.stableHome });
  assert.equal(blocked.reasonCode, 'DEV_HELPER_RUNTIME_INTEGRITY');
});

test('installer blocks an incomplete pre-existing runtime tree', t => {
  const fixture = profileFixture();
  const previousLauncher = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = fixture.launcher;
  t.after(() => {
    if (previousLauncher === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previousLauncher;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  const partialRuntime = path.join(fixture.runtime, 'node_modules', 'zod');
  fs.mkdirSync(partialRuntime, { recursive: true });
  fs.writeFileSync(path.join(partialRuntime, 'package.json'), JSON.stringify({ name: 'zod', version: '4.6.6' }));
  assert.throws(() => installVendoredDevHelper({ devHome: fixture.home, stableHome: fixture.stableHome }),
    /DEV_HELPER_RUNTIME_INTEGRITY/);
});
