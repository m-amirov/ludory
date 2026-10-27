import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { ownData } from './capabilities.mjs';
import { HELPER_INTEGRITY_CODES, verifyHelperArtifact } from './helper-supply.mjs';
import { canonicalPhysicalDirectory } from '@ludory/core';

const MAX_PROFILE_BYTES = 128 * 1024;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const UPSTREAM_INPUT_IMAGE_BYTES = 20_000_000;
const WEB_DEV_MODEL = 'gpt-6-sol';
const WEB_DEV_CANONICAL_MODEL = 'chatgpt-web/gpt-6-sol';
const WEB_DEV_BACKEND_MODEL = 'gpt-5.6-sol';
const BROWSER_OBSERVATION_V2 = 'browser_observation_v2';
const BROWSER_OBSERVATION_CALLBACK_TIMEOUT_MS = 10_000;
const UPSTREAM_POST_SUBMISSION_EVENTS = new Set([
  'heartbeat', 'generation_progress', 'tool_batch_observed', 'completion_fence_begin',
  'completion_fence_commit', 'multipart_stage_acknowledged', 'reasoning', 'commentary', 'text', 'luna_checkpoint',
]);
const CHILD_ENV_ALLOWLIST = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
  'TMP', 'TEMP', 'TMPDIR', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'ProgramFiles', 'ProgramFiles(x86)', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR',
  'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS'];
const unavailable = code => ({ available: false, reasonCode: code });
const errorWithCode = code => Object.assign(new Error(code), { code });
const sameCanonical = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;

function isolatedHome(home, stable) {
  if (sameCanonical(home, stable)) throw errorWithCode('DEV_PROFILE_NOT_ISOLATED');
  // Resolve NTFS short names, but reject symbolic links and junctions in every ancestor.
  let canonical;
  try { canonical = canonicalPhysicalDirectory(home); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw errorWithCode('DEV_PROFILE_NOT_ISOLATED');
  }
  try {
    if (sameCanonical(canonical, fs.realpathSync.native(stable))) {
      throw errorWithCode('DEV_PROFILE_NOT_ISOLATED');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return canonical;
}

function safeFile(file, base) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  // The path may contain 8.3 NTFS names. Canonicalize its real, non-junction
  // parent before checking containment; lstat keeps final-file symlinks out.
  let real;
  try {
    const parent = canonicalPhysicalDirectory(path.dirname(file));
    const candidate = path.join(parent, path.basename(file));
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
    real = fs.realpathSync.native(candidate);
  } catch { throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED'); }
  if (base) {
    const inside = path.relative(canonicalPhysicalDirectory(base), real);
    if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
      throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
    }
  }
  return real;
}

function safeExecutable(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  try {
    const initial = fs.lstatSync(file);
    if (!initial.isFile() || initial.isSymbolicLink()) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
    const real = fs.realpathSync.native(file);
    const resolved = fs.lstatSync(real);
    if (!resolved.isFile() || resolved.isSymbolicLink()) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
    return real;
  } catch { throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED'); }
}

function standardLauncherExecutables() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (typeof root === 'string' && root.trim()) {
        candidates.push(path.join(root, 'Programs', 'Codex Web GPT', 'Codex Web GPT.exe'));
      }
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT');
  } else {
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'codex-web-gpt'));
  }
  if (typeof process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE === 'string' &&
      process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE.trim()) {
    candidates.push(process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE.trim());
  }
  return candidates;
}

function isStandardLauncherExecutable(executable) {
  if (path.basename(executable).toLowerCase() !==
      (process.platform === 'win32' ? 'codex web gpt.exe' : 'codex-web-gpt')) return false;
  let real;
  try { real = fs.realpathSync.native(executable); } catch { return false; }
  return standardLauncherExecutables().some(candidate => {
    try { return sameCanonical(real, fs.realpathSync.native(candidate)); }
    catch { return false; }
  });
}

function registeredHelper({ executableFile, scriptFile, home }) {
  const executable = safeExecutable(executableFile);
  const script = safeFile(scriptFile);
  const profile = canonicalPhysicalDirectory(home);
  const relative = path.relative(profile, script);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!isStandardLauncherExecutable(executable)) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
    const expected = path.join(path.dirname(executable), 'resources', 'runtime', 'app', 'browser-helper.cjs');
    if (!sameCanonical(script, expected)) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  }
  const manifestFile = path.join(path.dirname(script), 'browser-helper.manifest.json');
  const integrity = verifyHelperArtifact({ scriptFile: script, manifestFile, checkRuntime: true });
  return { executable, script, manifestFile: integrity.manifestFile, integrity };
}

function readProfileJson(file, base) {
  safeFile(file, base);
  if (fs.statSync(file).size > MAX_PROFILE_BYTES) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  return value;
}

function observedRoute(value) {
  const model = ownData(value, 'modelObserved');
  if (ownData(value, 'transportVerified') !== true ||
      ownData(value, 'entitlementVerified') !== true ||
      ownData(value, 'routeObserved') !== 'web-dev' ||
      ownData(value, 'localToolsEnabled') !== false ||
      model !== WEB_DEV_MODEL) return null;
  return { available: true, reasonCode: 'AVAILABLE', modelObserved: model,
    transportVerified: true, entitlementVerified: true, routeObserved: 'web-dev',
    imageInputVerified: ownData(value, 'imageInputVerified') === true };
}

function validatedImages(images, maxBytes = MAX_INPUT_IMAGE_BYTES) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length !== 1) throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  const image = images[0];
  if (!image || typeof image !== 'object' || Array.isArray(image) ||
      typeof image.ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(image.ref) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) ||
      !Buffer.isBuffer(image.bytes) || image.bytes.length < 1 ||
      image.bytes.length > maxBytes ||
      typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)) {
    throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  }
  const bytes = Buffer.from(image.bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
    throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  }
  return [{ ref: image.ref, mimeType: image.mimeType, bytes, sha256: image.sha256 }];
}

function observedBrowserAttachment(value, image) {
  const attachment = ownData(value, 'image');
  if (ownData(value, 'protocolVersion') !== 2 || ownData(value, 'source') !== 'browser-ui' ||
      ownData(value, 'selectedModel') !== WEB_DEV_MODEL || ownData(value, 'reasoning') !== 'high' ||
      !attachment || typeof attachment !== 'object' || Array.isArray(attachment) ||
      ownData(attachment, 'ref') !== image.ref || ownData(attachment, 'sha256') !== image.sha256 ||
      ownData(attachment, 'bytes') !== image.bytes.length) return null;
  return { protocolVersion: 2, source: 'browser-ui', selectedModel: WEB_DEV_MODEL,
    reasoning: 'high', image: { ref: image.ref, sha256: image.sha256, bytes: image.bytes.length } };
}

function upstreamAttachment(value, image, traceId) {
  if (!value || value.version !== 2 || value.traceId !== traceId || value.source !== 'chatgpt-web-browser' ||
      value.model?.canonicalId !== WEB_DEV_CANONICAL_MODEL || value.model?.backendModelId !== WEB_DEV_BACKEND_MODEL ||
      value.model?.family !== '6' || value.model?.effort !== 'high' || typeof value.model.selectionLabel !== 'string' ||
      !value.model.selectionLabel.trim() || !Array.isArray(value.attachments) || value.attachments.length !== 1) return null;
  const attachment = value.attachments[0];
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.replace('image/', '');
  const upload = attachment?.upload;
  if (!attachment || attachment.ref !== image.ref || attachment.name !== `${image.ref}.${extension}` ||
      attachment.mimeType !== image.mimeType || attachment.sha256 !== image.sha256 || attachment.bytes !== image.bytes.length ||
      upload?.creationRequestObserved !== true || upload?.processingRequestObserved !== true ||
      !['process_upload_stream', 'claim_and_finish'].includes(upload.processingRequestKind) ||
      upload.processingEvent !== 'file.processing.completed' || upload.processingCompleted !== true ||
      upload.visibleAttachmentChip !== true) return null;
  return { protocolVersion: 2, source: 'browser-ui', traceId, selectedModel: WEB_DEV_MODEL,
    reasoning: 'high', image: { ref: image.ref, sha256: image.sha256, bytes: image.bytes.length },
    upload: { creationRequestObserved: true, processingRequestObserved: true,
      processingRequestKind: upload.processingRequestKind, processingEvent: upload.processingEvent,
      processingCompleted: true, visibleAttachmentChip: true } };
}

function timeoutPromise(promise, timeoutMs, code) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(errorWithCode(code)), timeoutMs))]);
}

function isolatedHelperEnv(home) {
  const env = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return { ...env,
    CODEX_WEB_GPT_DEV_HOME: home,
    CODEX_CHATGPT_WEB_HOME: home,
    CODEX_HOME: path.join(home, 'codex-home'),
    ELECTRON_RUN_AS_NODE: '1',
    CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS: '1',
  };
}

class BrowserDevHost {
  constructor({ home, descriptor, descriptorPath, spawnImpl, startupTimeoutMs, probeTimeoutMs, turnTimeoutMs }) {
    this.home = home;
    this.descriptor = descriptor;
    this.descriptorPath = descriptorPath;
    this.spawnImpl = spawnImpl;
    this.startupTimeoutMs = startupTimeoutMs;
    this.probeTimeoutMs = probeTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.child = null;
    this.starting = null;
    this.closing = null;
    this.pending = new Map();
    this.capability = null;
    this.active = false;
    this.available = false; // A descriptor cannot attest account/model availability.
    this.reasonCode = 'DEV_ROUTE_UNVERIFIED';
    this.profile = null;
    this.helperFeatures = new Set();
  }

  failPending(code) {
    for (const [id, operation] of this.pending) {
      clearTimeout(operation.timer);
      operation.reject(errorWithCode(code));
      this.pending.delete(id);
    }
  }

  async ensureChild() {
    try {
      this.descriptor.helper.integrity = verifyHelperArtifact({
        scriptFile: this.descriptor.helper.script,
        manifestFile: this.descriptor.helper.manifestFile,
        checkRuntime: true,
      });
    } catch (error) {
      if (this.child) await this.close();
      throw error;
    }
    if (this.child && this.starting) return this.starting;
    const child = this.spawnImpl(this.descriptor.helper.executable,
      [this.descriptor.helper.script], {
        shell: false, windowsHide: true, cwd: this.home,
        env: isolatedHelperEnv(this.home),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    this.child = child;
    this.starting = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => rejectReady('DEV_HELPER_START_TIMEOUT'), this.startupTimeoutMs);
      const resolveReady = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const rejectReady = code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void this.close();
        reject(errorWithCode(code));
      };
      const abort = code => {
        this.failPending(code);
        rejectReady(code);
        void this.close();
      };
      let bytes = 0;
      child.stdout.on('data', data => {
        bytes += data.length;
        if (bytes > MAX_STDOUT_BYTES) abort('DEV_HELPER_OUTPUT_LIMIT');
      });
      let stderrBytes = 0;
      child.stderr.on('data', data => {
        stderrBytes += data.length;
        if (stderrBytes > MAX_STDOUT_BYTES) abort('DEV_HELPER_OUTPUT_LIMIT');
      });
      child.stdin.on('error', () => abort('DEV_HELPER_SEND_FAILED'));
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on('line', line => {
        if (line.length > MAX_STDOUT_BYTES) {
          abort('DEV_HELPER_OUTPUT_LIMIT');
          return;
        }
        let message;
        try { message = JSON.parse(line); }
        catch { abort('DEV_HELPER_PROTOCOL_INVALID'); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          abort('DEV_HELPER_PROTOCOL_INVALID');
          return;
        }
        if (ownData(message, 'type') === 'ready') {
          const declaredProtocol = this.descriptor.helper.integrity.protocol.kind;
          const declaredFeatures = new Set(this.descriptor.helper.integrity.protocol.features);
          if (message.protocolVersion === 1 && declaredProtocol === 'compatibility-v1') {
            this.profile = 'legacy';
            this.helperFeatures = new Set();
            resolveReady();
          } else if (declaredProtocol === 'browser-observation-v2' &&
              Array.isArray(message.features) && message.features.every(feature => typeof feature === 'string') &&
              [...declaredFeatures].every(feature => message.features.includes(feature))) {
            this.profile = 'upstream';
            this.helperFeatures = new Set(message.features);
            resolveReady();
          } else abort('DEV_HELPER_PROTOCOL_UNSUPPORTED');
        } else this.handleMessage(message);
      });
      child.on('error', () => abort('DEV_HELPER_SPAWN_FAILED'));
      child.on('exit', () => {
        rejectReady('DEV_HELPER_EXITED');
        this.failPending('DEV_HELPER_EXITED');
        if (this.child === child) { this.child = null; this.starting = null; }
      });
    });
    return this.starting;
  }

  handleMessage(message) {
    const id = ownData(message, 'id');
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.profile === 'upstream') {
      this.handleUpstreamMessage(message, id, pending);
      return;
    }
    if (ownData(message, 'type') === 'event' && pending.kind === 'run') {
      const event = ownData(message, 'event');
      if (event === 'prepared_selected' && pending.phase === 'AWAIT_PREPARED') {
        pending.phase = 'PREPARED_ACK_PENDING';
        void this.send({ type: 'prepared_selected_ack', id,
          prepared: { text: pending.prompt, images: (pending.images ?? []).map(image => ({
            ref: image.ref,
            imageUrl: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
            detail: 'high',
          })) } }).then(() => {
          if (this.pending.get(id) === pending && pending.phase === 'PREPARED_ACK_PENDING') {
            pending.phase = 'AWAIT_ACTIVATED';
          }
        }).catch(() => this.rejectPending(id, 'DEV_HELPER_SEND_FAILED'));
      } else if (event === 'image_attached' && pending.phase === 'AWAIT_ACTIVATED' &&
          pending.images?.length === 1 && pending.imageAcknowledged !== true &&
          ownData(message, 'imageRef') === pending.images[0].ref &&
          ownData(message, 'imageSha256') === pending.images[0].sha256) {
        const observation = observedBrowserAttachment(ownData(message, 'hostObservation'), pending.images[0]);
        if (!observation) this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED');
        else {
          pending.imageAcknowledged = true;
          pending.hostObservation = observation;
        }
      } else if (event === 'send_activated' && pending.phase === 'AWAIT_ACTIVATED') {
        pending.phase = 'ACTIVATION_ACK_PENDING';
        void this.send({ type: 'send_activation_ack', id }).then(() => {
          if (this.pending.get(id) === pending && pending.phase === 'ACTIVATION_ACK_PENDING') {
            pending.phase = 'AWAIT_SUBMITTED';
          }
        }).catch(() => this.rejectPending(id, 'DEV_HELPER_SEND_FAILED'));
      } else if (event === 'submitted' && pending.phase === 'AWAIT_SUBMITTED') {
        if (pending.images?.length && !pending.imageAcknowledged) {
          this.rejectPending(id, 'DEV_IMAGE_INPUT_UNVERIFIED');
          return;
        }
        pending.phase = 'SUBMITTED';
        pending.submitted = true;
      } else this.rejectPending(id, 'DEV_HELPER_PROTOCOL_INVALID');
      return;
    }
    const type = ownData(message, 'type');
    if (type === 'capabilities' && pending.kind === 'probe') this.resolvePending(id, message);
    else if (type === 'result' && pending.kind === 'run') {
      if (pending.phase !== 'SUBMITTED') this.rejectPending(id, 'DEV_HELPER_PROTOCOL_INVALID');
      else if (pending.images?.length) {
        const resultObservation = observedBrowserAttachment(ownData(message, 'hostObservation'), pending.images[0]);
        if (!pending.hostObservation || !resultObservation ||
            JSON.stringify(resultObservation) !== JSON.stringify(pending.hostObservation)) {
          this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED');
        } else this.resolvePending(id, { ...message, submitted: true, hostObservation: pending.hostObservation });
      } else this.resolvePending(id, { ...message, submitted: true });
    }
    else if (type === 'error') this.rejectPending(id, 'DEV_HELPER_REJECTED');
  }

  handleUpstreamMessage(message, id, pending) {
    if (ownData(message, 'type') === 'result' && pending.kind === 'probe') {
      this.resolvePending(id, message); return;
    }
    if (ownData(message, 'type') === 'event') {
      const event = ownData(message, 'event');
      if (event === 'prepared_selected' && pending.phase === 'AWAIT_PREPARED') {
        pending.phase = 'PREPARED_ACK_PENDING';
        void this.send({ type: 'prepared_selected_ack', id,
          prepared: { text: pending.prompt, images: (pending.images ?? []).map(image => ({
            ref: image.ref, imageUrl: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`, detail: 'high',
          })) } }).then(() => {
            if (this.pending.get(id) === pending && pending.phase === 'PREPARED_ACK_PENDING') pending.phase = 'AWAIT_ACTIVATED';
          }).catch(() => this.rejectPending(id, 'DEV_HELPER_SEND_FAILED'));
      } else if (event === 'browser_observation_v2' && pending.phase === 'AWAIT_ACTIVATED') {
        const observation = pending.images?.length === 1
          ? upstreamAttachment(ownData(message, 'observation'), pending.images[0], id) : null;
        if (!observation) { this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED'); return; }
        pending.phase = 'OBSERVATION_CALLBACK_PENDING';
        pending.observation = observation;
        pending.observationCallback = Promise.resolve().then(() => {
          pending.phase = 'OBSERVATION_VALIDATED';
        });
        void pending.observationCallback.catch(() => this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_CALLBACK_FAILED'));
      } else if (event === 'send_activated') {
        if (pending.phase !== 'OBSERVATION_CALLBACK_PENDING' && pending.phase !== 'OBSERVATION_VALIDATED') {
          this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED'); return;
        }
        const callback = pending.observationCallback;
        if (!callback) { this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED'); return; }
        pending.phase = 'OBSERVATION_CALLBACK_WAIT';
        void timeoutPromise(callback, BROWSER_OBSERVATION_CALLBACK_TIMEOUT_MS, 'DEV_BROWSER_OBSERVATION_CALLBACK_TIMEOUT').then(() => {
          if (this.pending.get(id) !== pending) return;
          pending.phase = 'ACTIVATION_ACK_PENDING';
          return this.send({ type: 'send_activation_ack', id });
        }).then(() => {
          if (this.pending.get(id) === pending && pending.phase === 'ACTIVATION_ACK_PENDING') pending.phase = 'AWAIT_SUBMITTED';
        }).catch(error => this.rejectPending(id, error.code ?? 'DEV_BROWSER_OBSERVATION_CALLBACK_FAILED'));
      } else if (event === 'submitted' && pending.phase === 'AWAIT_SUBMITTED') {
        pending.phase = 'SUBMITTED'; pending.submitted = true;
      } else if (pending.phase === 'SUBMITTED' && UPSTREAM_POST_SUBMISSION_EVENTS.has(event)) {
        // Output/progress frames may follow the submission boundary. A late observation is
        // intentionally not in this allowlist and remains a protocol failure.
      } else this.rejectPending(id, 'DEV_HELPER_PROTOCOL_INVALID');
      return;
    }
    if (ownData(message, 'type') === 'result' && pending.kind === 'run') {
      if (pending.phase !== 'SUBMITTED' || !pending.observation || !pending.submitted ||
          typeof ownData(message, 'text') !== 'string') this.rejectPending(id, 'DEV_BROWSER_OBSERVATION_UNVERIFIED');
      else this.resolvePending(id, { ...message, submitted: true, observation: pending.observation });
    } else if (ownData(message, 'type') === 'error') this.rejectPending(id, 'DEV_HELPER_REJECTED');
  }

  observedUpstreamPreflight(value) {
    if (!value || value.authenticated !== true || value.newChat !== true ||
        typeof value.url !== 'string' || !value.url || value.solAvailable !== true ||
        !this.helperFeatures.has(BROWSER_OBSERVATION_V2)) return null;
    return { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
      modelRouteAvailable: WEB_DEV_CANONICAL_MODEL, browserObservationV2Available: true,
      reasoningRequired: 'high', preflight: { authenticated: true, newChat: true, url: value.url,
        solAvailable: true, extraHighAvailable: value.extraHighAvailable === true,
        proAvailable: value.proAvailable === true }, inspect: value };
  }

  resolvePending(id, value) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(value);
  }

  rejectPending(id, code) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.reject(errorWithCode(code));
  }

  async send(value) {
    if (!this.child?.stdin?.writable || this.child.stdin.destroyed) throw errorWithCode('DEV_HELPER_UNAVAILABLE');
    await new Promise((resolve, reject) => this.child.stdin.write(`${JSON.stringify(value)}\n`,
      failure => failure ? reject(failure) : resolve()));
  }

  async request(kind, payload, timeoutMs) {
    await this.ensureChild();
    const id = kind === 'run' && typeof payload.traceId === 'string' ? payload.traceId : randomUUID();
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectPending(id, 'DEV_HELPER_TIMEOUT'), timeoutMs);
      this.pending.set(id, { kind, ...payload, resolve, reject, timer, submitted: false,
        profile: this.profile, phase: kind === 'run' ? 'AWAIT_PREPARED' : 'AWAIT_CAPABILITY' });
    });
    const sending = this.profile === 'upstream'
      ? this.send(kind === 'probe'
        ? { type: 'inspect', id, config: { appName: 'ludory-web-art-review', browserHostDescriptorPath: this.descriptorPath }, detectCapabilities: true }
        : { type: 'run', id, config: { appName: 'ludory-web-art-review', browserHostDescriptorPath: this.descriptorPath,
            turnTimeoutMs: this.turnTimeoutMs, autoApproveToolCalls: false }, turn: { traceId: id, modelId: WEB_DEV_BACKEND_MODEL,
            modelFamily: '6', reasoning: 'high', capabilities: { localToolsEnabled: false,
              solAvailable: this.capability.inspect.solAvailable, extraHighAvailable: this.capability.inspect.extraHighAvailable ?? false,
              proAvailable: this.capability.inspect.proAvailable ?? false }, requireBrowserObservationV2: true } })
      : this.send({ type: kind === 'probe' ? 'capabilities' : 'run', id,
        ...(kind === 'run' && { config: { autoApproveToolCalls: false, useSavedChats: false },
          turn: { traceId: id, modelId: this.capability.modelObserved,
            requestedModel: `chatgpt-web/${this.capability.modelObserved}`, reasoning: 'high', capabilities: { localToolsEnabled: false } } }) });
    try { await Promise.race([sending, answer]); }
    catch (error) {
      this.rejectPending(id, 'DEV_HELPER_SEND_FAILED');
      throw error;
    }
    return answer;
  }

  async probe() {
    if (this.capability) return this.capability;
    let result;
    try { result = await this.request('probe', {}, this.probeTimeoutMs); }
    catch (error) {
      await this.close();
      return unavailable(HELPER_INTEGRITY_CODES.has(error?.code) ? error.code : 'DEV_ROUTE_UNVERIFIED');
    }
    const observed = this.profile === 'upstream' ? this.observedUpstreamPreflight(result?.value) : observedRoute(result);
    if (!observed) {
      await this.close();
      return unavailable('DEV_ROUTE_UNVERIFIED');
    }
    this.capability = observed;
    return observed;
  }

  async turn({ prompt, taskId, images }) {
    if (!this.capability) throw errorWithCode('DEV_ROUTE_UNVERIFIED');
    if (this.active) throw errorWithCode('DEV_HELPER_BUSY');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 64 * 1024 ||
        typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(taskId)) {
      throw errorWithCode('DEV_TASK_INVALID');
    }
    const visualInputs = validatedImages(images, this.profile === 'upstream' ? UPSTREAM_INPUT_IMAGE_BYTES : MAX_INPUT_IMAGE_BYTES);
    if (this.profile === 'legacy' && visualInputs.length && this.capability.imageInputVerified !== true) {
      throw errorWithCode('DEV_IMAGE_INPUT_UNVERIFIED');
    }
    this.active = true;
    try {
      const response = await this.request('run', { prompt, images: visualInputs, traceId: taskId }, this.turnTimeoutMs);
      if (this.profile === 'upstream') {
        if (!response?.observation || !response.submitted || typeof response.text !== 'string') throw errorWithCode('DEV_BROWSER_OBSERVATION_UNVERIFIED');
        if (typeof response.text !== 'string' || !response.text.trim() || Buffer.byteLength(response.text) > MAX_TEXT_BYTES) throw errorWithCode('DEV_RESPONSE_INVALID');
        const image = visualInputs[0];
        const hostObservation = image ? response.observation : null;
        if (!hostObservation) throw errorWithCode('DEV_BROWSER_OBSERVATION_UNVERIFIED');
        return { status: 'HOST_OBSERVED', text: response.text, routeObserved: 'web-dev', modelObserved: WEB_DEV_MODEL,
          imageInputObserved: true, imageRef: image.ref, imageSha256: image.sha256, imageBytes: image.bytes.length,
          traceId: taskId, hostObservation };
      }
      const observation = observedRoute(response);
      if (!observation || observation.modelObserved !== this.capability.modelObserved || !response.submitted) {
        throw errorWithCode('DEV_ROUTE_UNVERIFIED');
      }
      if (visualInputs.length && (ownData(response, 'imageInputObserved') !== true ||
          ownData(response, 'imageRef') !== visualInputs[0].ref ||
          ownData(response, 'imageSha256') !== visualInputs[0].sha256 ||
          JSON.stringify(ownData(response, 'hostObservation')) !== JSON.stringify(
            observedBrowserAttachment(ownData(response, 'hostObservation'), visualInputs[0])))) {
        throw errorWithCode('DEV_IMAGE_INPUT_UNVERIFIED');
      }
      if (typeof response.text !== 'string' || !response.text.trim() ||
          Buffer.byteLength(response.text) > MAX_TEXT_BYTES) throw errorWithCode('DEV_RESPONSE_INVALID');
      return { status: 'HOST_OBSERVED', text: response.text,
        modelObserved: observation.modelObserved, routeObserved: 'web-dev',
        ...(visualInputs.length && { imageInputObserved: true,
          imageRef: visualInputs[0].ref, imageSha256: visualInputs[0].sha256,
          hostObservation: observedBrowserAttachment(ownData(response, 'hostObservation'), visualInputs[0]) }) };
    } catch (error) {
      await this.close();
      throw error;
    } finally { this.active = false; }
  }

  async close() {
    if (this.closing) return this.closing;
    this.failPending('DEV_HELPER_CLOSED');
    const child = this.child;
    this.child = null;
    this.starting = null;
    this.capability = null;
    if (!child) return;
    this.closing = (async () => {
      const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve()
        : new Promise(resolve => child.once('exit', resolve));
      try { child.stdin.end(); } catch { /* Already closed. */ }
      try { child.kill('SIGTERM'); } catch { /* Already exited. */ }
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* Already exited. */ }
        }
      }, 500);
      await exited;
      clearTimeout(force);
    })();
    try { await this.closing; }
    finally { this.closing = null; }
  }
}

/** Only a compatible installed, isolated DEV helper may grant an executable route. */
export function discoverDevHost({ devHome = process.env.CODEX_WEB_GPT_DEV_HOME ||
  path.join(os.homedir(), '.codex-chatgpt-web-dev'),
stableHome = process.env.CODEX_CHATGPT_WEB_HOME || path.join(os.homedir(), '.codex-chatgpt-web'),
spawnImpl = spawn, startupTimeoutMs = 15_000, probeTimeoutMs = 3_000, turnTimeoutMs = 1_800_000 } = {}) {
  const requestedHome = path.resolve(devHome);
  const stable = path.resolve(stableHome);
  try {
    const home = isolatedHome(requestedHome, stable);
    const config = readProfileJson(path.join(home, 'config.json'), home);
    if (config.version !== 3 || config.mode !== 'browser-only' ||
        typeof config.releaseVersion !== 'string') return unavailable('DEV_DESCRIPTOR_UNTRUSTED');
    const descriptorPath = config.browserHostDescriptorPath || path.join(home, 'runtime', 'launcher-browser.json');
    const safeDescriptorPath = safeFile(descriptorPath, home);
    const descriptor = readProfileJson(safeDescriptorPath, home);
    if (descriptor.profile !== 'development' || descriptor.kind !== 'codex-web-gpt-launcher' ||
        !descriptor.helper || typeof descriptor.helper !== 'object') return unavailable('DEV_DESCRIPTOR_UNTRUSTED');
    const helper = registeredHelper({ executableFile: descriptor.helper.executable,
      scriptFile: config.browserHelperScriptPath || descriptor.helper.script, home });
    return new BrowserDevHost({ home, descriptor: { helper }, descriptorPath: safeDescriptorPath, spawnImpl,
      startupTimeoutMs, probeTimeoutMs, turnTimeoutMs });
  } catch (error) {
    return unavailable([...HELPER_INTEGRITY_CODES, 'DEV_DESCRIPTOR_UNTRUSTED', 'DEV_PROFILE_NOT_ISOLATED'].includes(error.code)
      ? error.code : 'DEV_HOST_UNAVAILABLE');
  }
}
