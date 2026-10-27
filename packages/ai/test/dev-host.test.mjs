import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { discoverDevHost } from '../src/dev-host.mjs';

function fixture(helperSource, mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-dev-host-'));
  const home = path.join(root, 'dev');
  const stableHome = path.join(root, 'stable');
  const runtime = path.join(home, 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const script = path.join(runtime, 'helper.cjs');
  fs.writeFileSync(script, helperSource);
  const descriptor = {
    profile: 'development', kind: 'codex-web-gpt-launcher',
    helper: { executable: process.execPath, script },
  };
  mutate(descriptor, { root, home, stableHome, runtime, script });
  fs.writeFileSync(path.join(runtime, 'launcher-browser.json'), JSON.stringify(descriptor));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    version: 3, releaseVersion: '6.1.11', mode: 'browser-only',
    browserHostDescriptorPath: path.join(runtime, 'launcher-browser.json'),
  }));
  return { home, stableHome, root };
}

const helper = ({ observed = true, submit = true } = {}) => `
const readline = require('node:readline');
const accepted = ${JSON.stringify(observed)};
const submit = ${JSON.stringify(submit)};
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
send({ type: 'ready', protocolVersion: 1 });
readline.createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'capabilities') {
    send({ type: 'capabilities', id:message.id, ...(accepted ? {
      transportVerified:true, entitlementVerified:true, routeObserved:'web-dev',
      modelObserved:'gpt-6-sol', localToolsEnabled:false
    } : { transportVerified:true, entitlementVerified:false }) });
  } else if (message.type === 'run') {
    send({ type:'event', id:message.id, event:'prepared_selected' });
  } else if (message.type === 'prepared_selected_ack') {
    if (!message.prepared.text.includes('source-bound')) process.exit(3);
    send({ type:'event', id:message.id, event:'send_activated' });
  } else if (message.type === 'send_activation_ack') {
    if (submit) send({ type:'event', id:message.id, event:'submitted' });
    send({ type:'result', id:message.id, text:'# Draft\\nA new scene',
      ...(accepted ? {modelObserved:'gpt-6-sol', routeObserved:'web-dev',
        transportVerified:true, entitlementVerified:true, localToolsEnabled:false} : {}) });
  }
});
`;

function cleanupHost(t, root, host) {
  t.after(async () => {
    await host.close?.();
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test('missing DEV profile and identical Stable home deny all execution', async t => {
  const absent = discoverDevHost({ devHome: path.join(os.tmpdir(), 'ludory-dev-host-no-such-home'),
    stableHome: path.join(os.tmpdir(), 'ludory-dev-host-no-such-stable') });
  assert.equal(absent.available, false);
  assert.equal(absent.reasonCode, 'DEV_HOST_UNAVAILABLE');

  const { home, root } = fixture(helper());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unsafe = discoverDevHost({ devHome: home, stableHome: home });
  assert.equal(unsafe.available, false);
  assert.equal(unsafe.reasonCode, 'DEV_PROFILE_NOT_ISOLATED');
});

test('descriptor cannot redirect helper execution outside the isolated DEV home', async t => {
  const { home, stableHome, root } = fixture(helper(), d => { d.helper.script = '/tmp/foreign-helper.cjs'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unsafe = discoverDevHost({ devHome: home, stableHome });
  assert.equal(unsafe.available, false);
  assert.equal(unsafe.reasonCode, 'DEV_DESCRIPTOR_UNTRUSTED');
});

test('officially registered launcher helper may live beside the installed Codex Web GPT executable', async t => {
  const previous = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
  const { home, stableHome, root } = fixture(helper(), (descriptor, paths) => {
    const install = path.join(paths.root, 'Codex Web GPT');
    const registeredScript = path.join(install, 'resources', 'runtime', 'app', 'browser-helper.cjs');
    const registeredExecutable = path.join(install,
      process.platform === 'win32' ? 'Codex Web GPT.exe' : 'codex-web-gpt');
    fs.mkdirSync(path.dirname(registeredScript), { recursive: true });
    fs.copyFileSync(process.execPath, registeredExecutable);
    fs.copyFileSync(paths.script, registeredScript);
    descriptor.helper = { executable: registeredExecutable, script: registeredScript };
    process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = registeredExecutable;
  });
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE;
    else process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const host = discoverDevHost({ devHome: home, stableHome });
  assert.equal(typeof host.probe, 'function');
  await host.close();
});

test('DEV symlink alias to Stable or symlinked ancestor is rejected without spawning', t => {
  const { home, stableHome, root } = fixture(helper());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const alias = path.join(root, 'alias-to-stable');
  fs.symlinkSync(home, alias, 'dir');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    version: 3, releaseVersion: '6.1.11', mode: 'browser-only',
    browserHostDescriptorPath: path.join(alias, 'runtime', 'launcher-browser.json'),
  }));
  const descriptorFile = path.join(home, 'runtime', 'launcher-browser.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
  descriptor.helper.script = path.join(alias, 'runtime', 'helper.cjs');
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  let spawned = false;
  const settings = { spawnImpl: () => { spawned = true; throw new Error('should not launch'); } };
  const samePhysicalProfile = discoverDevHost({ ...settings, devHome: alias, stableHome: home });
  assert.equal(samePhysicalProfile.available, false);
  assert.equal(samePhysicalProfile.reasonCode, 'DEV_PROFILE_NOT_ISOLATED');
  assert.equal(spawned, false);
  const parentAlias = path.join(path.dirname(root), `${path.basename(root)}-parent-alias`);
  fs.symlinkSync(root, parentAlias, 'dir');
  t.after(() => fs.unlinkSync(parentAlias));
  const aliasedAncestor = discoverDevHost({ ...settings, devHome: path.join(parentAlias, 'dev'), stableHome });
  assert.equal(aliasedAncestor.available, false);
  assert.equal(spawned, false);
});

test('witnessed helper route permits one source-bound browser-only text turn', async t => {
  const { home, stableHome, root } = fixture(helper());
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  assert.equal(host.available, false); // Installation is not entitlement.
  const cap = await host.probe();
  assert.equal(cap.available, true);
  assert.equal(cap.modelObserved, 'gpt-6-sol');
  const result = await host.turn({ prompt: 'source-bound instructions', taskId: 'test-run-1' });
  assert.equal(result.status, 'HOST_OBSERVED');
  assert.equal(result.text, '# Draft\nA new scene');
  assert.equal(result.modelObserved, 'gpt-6-sol');
});

test('helper without model-entitlement observation never becomes runnable', async t => {
  const { home, stableHome, root } = fixture(helper({ observed: false }));
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  const cap = await host.probe();
  assert.equal(cap.available, false);
  assert.equal(cap.reasonCode, 'DEV_ROUTE_UNVERIFIED');
  await assert.rejects(host.turn({ prompt: 'source-bound instructions', taskId: 'test-run-2' }),
    /DEV_ROUTE_UNVERIFIED/);
});

test('legacy helper without capability handshake is closed after a bounded probe', async t => {
  const olderHelper = `
    const readline = require('node:readline');
    process.stdout.write(JSON.stringify({type:'ready',protocolVersion:1})+'\\n');
    readline.createInterface({input:process.stdin}).on('line', () => {});
  `;
  const { home, stableHome, root } = fixture(olderHelper);
  const host = discoverDevHost({ devHome: home, stableHome, probeTimeoutMs: 75 });
  cleanupHost(t, root, host);
  const cap = await host.probe();
  assert.equal(cap.available, false);
  assert.equal(cap.reasonCode, 'DEV_ROUTE_UNVERIFIED');
  assert.equal(host.child, null, 'a legacy helper must not remain running after denied preflight');
});

test('DEV host refuses non-GPT-6 Sol Web route before accepting a task', async t => {
  const { home, stableHome, root } = fixture(helper().replaceAll('gpt-6-sol', 'gpt-5.6-sol'));
  const dev = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, dev);
  const cap = await dev.probe();
  assert.equal(cap.available, false);
  assert.equal(cap.reasonCode, 'DEV_ROUTE_UNVERIFIED');
  await assert.rejects(dev.turn({ prompt: 'draft', taskId: 'wrong-model' }), /DEV_ROUTE_UNVERIFIED/);
});

test('isolated DEV process receives only a constrained environment, not ambient service credentials', async t => {
  const { home, stableHome, root } = fixture(helper());
  let environment;
  let childCwd;
  const host = discoverDevHost({ devHome: home, stableHome,
    spawnImpl: (exe, args, options) => {
      environment = options.env;
      childCwd = options.cwd;
      return spawn(exe, args, options);
    } });
  cleanupHost(t, root, host);
  const capability = await host.probe();
  assert.equal(capability.available, true);
  assert.equal(childCwd, fs.realpathSync.native(home), 'helper must not inherit the game or invoking CLI directory');
  assert.equal(environment.CODEX_WEB_GPT_DEV_HOME, fs.realpathSync.native(home));
  const allowed = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
    'TMP', 'TEMP', 'TMPDIR', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA',
    'ProgramFiles', 'ProgramFiles(x86)', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR',
    'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS',
    'CODEX_WEB_GPT_DEV_HOME', 'CODEX_CHATGPT_WEB_HOME', 'CODEX_HOME',
    'ELECTRON_RUN_AS_NODE', 'CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS']);
  assert.deepEqual(Object.keys(environment).filter(key => !allowed.has(key)), []);
});

test('post-ready aggregate stdout overflow closes the helper instead of waiting for a turn timeout', async t => {
  const flood = `
const readline = require('node:readline');
const send = obj => process.stdout.write(JSON.stringify(obj) + '\\n');
send({type:'ready',protocolVersion:1});
readline.createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'capabilities') send({type:'capabilities',id:message.id,
    transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',modelObserved:'gpt-6-sol',localToolsEnabled:false});
  if (message.type === 'run') {
    for(let i=0;i<120;i++) send({type:'event',id:'foreign-'+i,event:'noise',padding:'x'.repeat(100000)});
  }
});`;
  const { home, stableHome, root } = fixture(flood);
  const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 3000 });
  cleanupHost(t, root, dev);
  assert.equal((await dev.probe()).available, true);
  await assert.rejects(dev.turn({ prompt: 'source-bound test', taskId: 'overflow' }), /DEV_HELPER_OUTPUT_LIMIT/);
  assert.equal(dev.child, null);
});

test('turn timeout terminates the helper instead of retaining an unresponsive child', async t => {
  const neverCompletes = helper().replace("send({ type:'result', id:message.id, text:'# Draft\\nA new scene',",
    "return; /* no result */ send({ type:'result', id:message.id, text:'# Draft\\nA new scene',");
  const { home, stableHome, root } = fixture(neverCompletes);
  const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 100 });
  cleanupHost(t, root, dev);
  assert.equal((await dev.probe()).available, true);
  await assert.rejects(dev.turn({ prompt: 'source-bound test', taskId: 'timeout' }), /DEV_HELPER_TIMEOUT/);
  assert.equal(dev.child, null);
});

test('a helper that stops reading stdin cannot hang a bounded turn beyond its timeout', async t => {
  const blockedStdin = `
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'ready',protocolVersion:1});
const rl = readline.createInterface({input:process.stdin});
rl.on('line', line => {
  const item = JSON.parse(line);
  if(item.type==='capabilities') {
    send({type:'capabilities',id:item.id,transportVerified:true,entitlementVerified:true,
      routeObserved:'web-dev',modelObserved:'gpt-6-sol',localToolsEnabled:false});
    rl.pause();
  }
});`;
  const { home, stableHome, root } = fixture(blockedStdin);
  const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 150 });
  cleanupHost(t, root, dev);
  assert.equal((await dev.probe()).available, true);
  // Deterministically model an unresolved child stdin callback (pipe backpressure).
  const originalWrite = dev.child.stdin.write;
  dev.child.stdin.write = function (chunk, callback) {
    if (String(chunk).includes('"type":"run"')) return true;
    return originalWrite.call(this, chunk, callback);
  };
  const guarded = Promise.race([
    dev.turn({ prompt: 'x'.repeat(60 * 1024), taskId: 'stdin-stall' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TEST_SEND_HUNG')), 1700)),
  ]);
  await assert.rejects(guarded, /DEV_HELPER_TIMEOUT/);
  assert.equal(dev.child, null);
});

test('out-of-order submitted/result frames never attest a prompt that was not sent', async t => {
  const skippedHandshake = `
const rl = require('node:readline');
const send = obj => process.stdout.write(JSON.stringify(obj)+'\\n');
send({type:'ready',protocolVersion:1});
rl.createInterface({input:process.stdin}).on('line', line => {
  const item = JSON.parse(line);
  if (item.type==='capabilities') send({type:'capabilities',id:item.id,
    transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',
    modelObserved:'gpt-6-sol',localToolsEnabled:false});
  if (item.type==='run') {
    send({type:'event',id:item.id,event:'submitted'});
    send({type:'result',id:item.id,text:'Fabricated',modelObserved:'gpt-6-sol',
      transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',localToolsEnabled:false});
  }
});`;
  const { home, stableHome, root } = fixture(skippedHandshake);
  const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 300 });
  cleanupHost(t, root, dev);
  assert.equal((await dev.probe()).available, true);
  await assert.rejects(dev.turn({ prompt: 'source-bound prompt never sent', taskId: 'fake' }),
    /DEV_HELPER_PROTOCOL_INVALID|DEV_ROUTE_UNVERIFIED/);
});

test('ack-dependent helper frames cannot claim receipt of a prompt before acknowledgement was written', async t => {
  const premature = `
const rl = require('node:readline');
const send = obj => process.stdout.write(JSON.stringify(obj)+'\\n');
send({type:'ready',protocolVersion:1});
rl.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line);
 if(item.type==='capabilities') send({type:'capabilities',id:item.id,
  transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',
  modelObserved:'gpt-6-sol',localToolsEnabled:false});
 if(item.type==='run') {
  // Deliver all premature frames in one transport batch: separate writes can
  // race the parent's ACK write on slower CI runners and become post-ACK frames.
  process.stdout.write([
   {type:'event',id:item.id,event:'prepared_selected'},
   {type:'event',id:item.id,event:'send_activated'},
   {type:'event',id:item.id,event:'submitted'},
   {type:'result',id:item.id,text:'Fake',modelObserved:'gpt-6-sol',
    transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',localToolsEnabled:false}
  ].map(frame => JSON.stringify(frame)).join('\\n')+'\\n');
 }
});`;
  const { home, stableHome, root } = fixture(premature);
  const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 300 });
  cleanupHost(t, root, dev);
  assert.equal((await dev.probe()).available, true);
  await assert.rejects(dev.turn({ prompt: 'source-bound', taskId: 'premature' }),
    /DEV_HELPER_PROTOCOL_INVALID/);
});

test('nonobject protocol frame and a closing stdin fail closed without crashing Node', async t => {
  for (const afterCapabilities of [
    `process.stdout.write('null\\n');`,
    `process.stdin.destroy();`,
  ]) {
    const source = `
const rl = require('node:readline');
const send = obj => process.stdout.write(JSON.stringify(obj)+'\\n');
send({type:'ready',protocolVersion:1});
rl.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line);
 if(item.type==='capabilities') {
  send({type:'capabilities',id:item.id,transportVerified:true,entitlementVerified:true,
   modelObserved:'gpt-6-sol',routeObserved:'web-dev',localToolsEnabled:false});
  ${afterCapabilities}
 }
});`;
    const { home, stableHome, root } = fixture(source);
    const dev = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 250 });
    cleanupHost(t, root, dev);
    const cap = await dev.probe();
    if (cap.available) await assert.rejects(dev.turn({ prompt: 'source-bound', taskId: 'closed' }),
      /DEV_HELPER_/);
    else assert.equal(cap.available, false);
  }
});

test('visual DEV turn submits the exact binary and requires a witnessed image receipt', async t => {
  const payload = Buffer.from('fixture-image-binary-not-rendered');
  const expectedHash = createHash('sha256').update(payload).digest('hex');
  const script = `
const readline = require('node:readline');
const crypto = require('node:crypto');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'ready',protocolVersion:1});
let observed;
readline.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line);
 if(item.type==='capabilities') send({type:'capabilities',id:item.id,
  transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',
  modelObserved:'gpt-6-sol',localToolsEnabled:false,imageInputVerified:true});
 if(item.type==='run') send({type:'event',id:item.id,event:'prepared_selected'});
 if(item.type==='prepared_selected_ack') {
  const image=item.prepared.images[0];
  if(!image || image.detail!=='high' || !image.imageUrl.startsWith('data:image/png;base64,')) process.exit(7);
  const bytes=Buffer.from(image.imageUrl.split(',')[1],'base64');
  observed={ref:image.ref,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  send({type:'event',id:item.id,event:'image_attached',imageRef:observed.ref,imageSha256:observed.sha256,
   hostObservation:{protocolVersion:2,source:'browser-ui',selectedModel:'gpt-6-sol',reasoning:'high',image:observed}});
  send({type:'event',id:item.id,event:'send_activated'});
 }
 if(item.type==='send_activation_ack') {
  send({type:'event',id:item.id,event:'submitted'});
  send({type:'result',id:item.id,text:'review payload',transportVerified:true,
   entitlementVerified:true,routeObserved:'web-dev',modelObserved:'gpt-6-sol',
   localToolsEnabled:false,imageInputObserved:true,imageRef:observed.ref,imageSha256:observed.sha256,
   hostObservation:{protocolVersion:2,source:'browser-ui',selectedModel:'gpt-6-sol',reasoning:'high',image:observed}});
 }
});`;
  const { home, stableHome, root } = fixture(script);
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  assert.equal((await host.probe()).imageInputVerified, true);
  const result = await host.turn({ prompt: 'source-bound visual task', taskId: 'art-review-1',
    images: [{ ref: 'candidate-1', mimeType: 'image/png', bytes: payload, sha256: expectedHash }] });
  assert.equal(result.imageInputObserved, true);
  assert.equal(result.imageSha256, expectedHash);
  assert.equal(result.imageRef, 'candidate-1');
  assert.equal(result.modelObserved, 'gpt-6-sol');
  assert.deepEqual(result.hostObservation, { protocolVersion: 2, source: 'browser-ui',
    selectedModel: 'gpt-6-sol', reasoning: 'high', image: { ref: 'candidate-1',
      sha256: expectedHash, bytes: payload.length } });
});

test('visual DEV turn rejects declared model and image fields without browser observation', async t => {
  const payload = Buffer.from('declared-but-not-browser-observed');
  const expectedHash = createHash('sha256').update(payload).digest('hex');
  const script = `
const readline = require('node:readline');
const crypto = require('node:crypto');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'ready',protocolVersion:1});
let observed;
readline.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line);
 if(item.type==='capabilities') send({type:'capabilities',id:item.id,
  transportVerified:true,entitlementVerified:true,routeObserved:'web-dev',
  modelObserved:'gpt-6-sol',localToolsEnabled:false,imageInputVerified:true});
 if(item.type==='run') send({type:'event',id:item.id,event:'prepared_selected'});
 if(item.type==='prepared_selected_ack') {
  const image=item.prepared.images[0];
  observed={ref:image.ref,sha256:crypto.createHash('sha256').update(Buffer.from(image.imageUrl.split(',')[1],'base64')).digest('hex')};
  send({type:'event',id:item.id,event:'image_attached',imageRef:observed.ref,imageSha256:observed.sha256});
  send({type:'event',id:item.id,event:'send_activated'});
 }
 if(item.type==='send_activation_ack') {
  send({type:'event',id:item.id,event:'submitted'});
  send({type:'result',id:item.id,text:'declared-only',transportVerified:true,
   entitlementVerified:true,routeObserved:'web-dev',modelObserved:'gpt-6-sol',
   localToolsEnabled:false,imageInputObserved:true,imageRef:observed.ref,imageSha256:observed.sha256});
 }
});`;
  const { home, stableHome, root } = fixture(script);
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  await host.probe();
  await assert.rejects(host.turn({ prompt: 'source-bound visual task', taskId: 'art-review-observation',
    images: [{ ref: 'candidate-1', mimeType: 'image/png', bytes: payload, sha256: expectedHash }] }),
  /DEV_BROWSER_OBSERVATION_UNVERIFIED/);
});

test('visual DEV turn rejects helper without witnessed attachment support', async t => {
  const { home, stableHome, root } = fixture(helper());
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  assert.equal((await host.probe()).available, true);
  const payload = Buffer.from('image');
  await assert.rejects(host.turn({ prompt: 'visual', taskId: 'needs-image',
    images: [{ ref: 'candidate', mimeType: 'image/png', bytes: payload,
      sha256: createHash('sha256').update(payload).digest('hex') }] }), /DEV_IMAGE_INPUT_UNVERIFIED/);
});

test('upstream browser_observation_v2 binds one trace to Sol model, upload proof and source bytes', async t => {
  const payload = Buffer.from('upstream-v2-image');
  const expectedHash = createHash('sha256').update(payload).digest('hex');
  const script = `
const readline = require('node:readline');
const crypto = require('node:crypto');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'ready',features:['browser_observation_v2']});
readline.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line);
 if(item.type==='inspect') send({type:'result',id:item.id,value:{authenticated:true,newChat:true,url:'https://chatgpt.com/',solAvailable:true,extraHighAvailable:false,proAvailable:true}});
 if(item.type==='run') send({type:'event',id:item.id,event:'prepared_selected',reused:false});
 if(item.type==='prepared_selected_ack') {
  const image=item.prepared.images[0];
  if(!image) { send({type:'event',id:item.id,event:'send_activated'}); return; }
  const bytes=Buffer.from(image.imageUrl.split(',')[1],'base64');
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  send({type:'event',id:item.id,event:'browser_observation_v2',observation:{version:2,traceId:item.id,source:'chatgpt-web-browser',
    model:{canonicalId:'chatgpt-web/gpt-6-sol',backendModelId:'gpt-5.6-sol',family:'6',effort:'high',selectionLabel:'High'},
    attachments:[{ref:image.ref,name:'candidate.png',mimeType:'image/png',sha256:sha,bytes:bytes.length,
      upload:{creationRequestObserved:true,processingRequestObserved:true,processingRequestKind:'process_upload_stream',processingEvent:'file.processing.completed',processingCompleted:true,visibleAttachmentChip:true}}]}});
  send({type:'event',id:item.id,event:'send_activated'});
 }
  if(item.type==='send_activation_ack') {
    send({type:'event',id:item.id,event:'submitted'});
    send({type:'event',id:item.id,event:'generation_progress'});
    send({type:'event',id:item.id,event:'heartbeat'});
    send({type:'result',id:item.id,text:'real browser response'});
  }
});`;
  const { home, stableHome, root } = fixture(script);
  const host = discoverDevHost({ devHome: home, stableHome });
  cleanupHost(t, root, host);
  const preflight = await host.probe();
  assert.equal(preflight.browserObservationV2Available, true);
  assert.equal(preflight.modelObserved, undefined);
  const result = await host.turn({ prompt: 'source-bound visual task', taskId: 'art-review-v2',
    images: [{ ref: 'candidate', mimeType: 'image/png', bytes: payload, sha256: expectedHash }] });
  assert.equal(result.status, 'HOST_OBSERVED');
  assert.equal(result.modelObserved, 'gpt-6-sol');
  assert.equal(result.traceId, 'art-review-v2');
  assert.equal(result.imageSha256, expectedHash);
  assert.equal(result.imageBytes, payload.length);
  assert.equal(result.hostObservation.protocolVersion, 2);
  assert.equal(result.hostObservation.upload.processingCompleted, true);
});

test('upstream v2 refuses a missing attachment without sending', async t => {
  const { home, stableHome, root } = fixture(`
const readline = require('node:readline'); const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'ready',features:['browser_observation_v2']}); readline.createInterface({input:process.stdin}).on('line', line => {
 const item=JSON.parse(line); if(item.type==='inspect') send({type:'result',id:item.id,value:{authenticated:true,newChat:true,url:'https://chatgpt.com/',solAvailable:true}});
 if(item.type==='run') send({type:'event',id:item.id,event:'prepared_selected',reused:false});
 if(item.type==='prepared_selected_ack') send({type:'event',id:item.id,event:'send_activated'});
});`);
  const host = discoverDevHost({ devHome: home, stableHome, turnTimeoutMs: 300 }); cleanupHost(t, root, host);
  assert.equal((await host.probe()).available, true);
  await assert.rejects(host.turn({ prompt: 'source-bound visual task', taskId: 'missing-image' }),
    /DEV_BROWSER_OBSERVATION_UNVERIFIED/);
});
