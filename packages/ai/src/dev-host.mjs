import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { ownData } from './capabilities.mjs';
import { canonicalPhysicalDirectory } from '@ludory/core';

const MAX_PROFILE_BYTES = 128 * 1024;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const WEB_DEV_MODEL = 'gpt-6-sol';
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

function validatedImages(images) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length !== 1) throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  const image = images[0];
  if (!image || typeof image !== 'object' || Array.isArray(image) ||
      typeof image.ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(image.ref) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) ||
      !Buffer.isBuffer(image.bytes) || image.bytes.length < 1 ||
      image.bytes.length > MAX_INPUT_IMAGE_BYTES ||
      typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)) {
    throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  }
  const bytes = Buffer.from(image.bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
    throw errorWithCode('DEV_IMAGE_INPUT_INVALID');
  }
  return [{ ref: image.ref, mimeType: image.mimeType, bytes, sha256: image.sha256 }];
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
  constructor({ home, descriptor, spawnImpl, startupTimeoutMs, probeTimeoutMs, turnTimeoutMs }) {
    this.home = home;
    this.descriptor = descriptor;
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
  }

  failPending(code) {
    for (const [id, operation] of this.pending) {
      clearTimeout(operation.timer);
      operation.reject(errorWithCode(code));
      this.pending.delete(id);
    }
  }

  async ensureChild() {
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
          if (message.protocolVersion !== 1) abort('DEV_HELPER_PROTOCOL_UNSUPPORTED');
          else resolveReady();
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
        pending.imageAcknowledged = true;
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
      else this.resolvePending(id, { ...message, submitted: true });
    }
    else if (type === 'error') this.rejectPending(id, 'DEV_HELPER_REJECTED');
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
    const id = randomUUID();
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectPending(id, 'DEV_HELPER_TIMEOUT'), timeoutMs);
      this.pending.set(id, { kind, ...payload, resolve, reject, timer, submitted: false,
        phase: kind === 'run' ? 'AWAIT_PREPARED' : 'AWAIT_CAPABILITY' });
    });
    const sending = this.send({ type: kind === 'probe' ? 'capabilities' : 'run', id,
      ...(kind === 'run' && { config: { autoApproveToolCalls: false, useSavedChats: false },
        turn: { traceId: id, modelId: this.capability.modelObserved,
          requestedModel: `chatgpt-web/${this.capability.modelObserved}`,
          reasoning: 'high', capabilities: { localToolsEnabled: false } } }) });
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
    catch {
      await this.close();
      return unavailable('DEV_ROUTE_UNVERIFIED');
    }
    const observed = observedRoute(result);
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
    const visualInputs = validatedImages(images);
    if (visualInputs.length && this.capability.imageInputVerified !== true) {
      throw errorWithCode('DEV_IMAGE_INPUT_UNVERIFIED');
    }
    this.active = true;
    try {
      const response = await this.request('run', { prompt, images: visualInputs }, this.turnTimeoutMs);
      const observation = observedRoute(response);
      if (!observation || observation.modelObserved !== this.capability.modelObserved || !response.submitted) {
        throw errorWithCode('DEV_ROUTE_UNVERIFIED');
      }
      if (visualInputs.length && (ownData(response, 'imageInputObserved') !== true ||
          ownData(response, 'imageRef') !== visualInputs[0].ref ||
          ownData(response, 'imageSha256') !== visualInputs[0].sha256)) {
        throw errorWithCode('DEV_IMAGE_INPUT_UNVERIFIED');
      }
      if (typeof response.text !== 'string' || !response.text.trim() ||
          Buffer.byteLength(response.text) > MAX_TEXT_BYTES) throw errorWithCode('DEV_RESPONSE_INVALID');
      return { status: 'HOST_OBSERVED', text: response.text,
        modelObserved: observation.modelObserved, routeObserved: 'web-dev',
        ...(visualInputs.length && { imageInputObserved: true,
          imageRef: visualInputs[0].ref, imageSha256: visualInputs[0].sha256 }) };
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
    const descriptor = readProfileJson(descriptorPath, home);
    if (descriptor.profile !== 'development' || descriptor.kind !== 'codex-web-gpt-launcher' ||
        !descriptor.helper || typeof descriptor.helper !== 'object') return unavailable('DEV_DESCRIPTOR_UNTRUSTED');
    const executable = safeFile(descriptor.helper.executable);
    const script = safeFile(descriptor.helper.script, home);
    return new BrowserDevHost({ home, descriptor: { helper: { executable, script } }, spawnImpl,
      startupTimeoutMs, probeTimeoutMs, turnTimeoutMs });
  } catch (error) {
    return unavailable(['DEV_DESCRIPTOR_UNTRUSTED', 'DEV_PROFILE_NOT_ISOLATED'].includes(error.code)
      ? error.code : 'DEV_HOST_UNAVAILABLE');
  }
}
