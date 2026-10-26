import { ownData } from './capabilities.mjs';
import { MAX_IMAGE_BYTES } from './image-artifacts.mjs';

const unavailable = reasonCode => ({ available: false, reasonCode });
const MODELS = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
// One PNG per paid request; bound its base64 JSON envelope accordingly.
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 * 1024;

async function boundedJson(response) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID');
        count += value.byteLength;
        if (count > MAX_RESPONSE_BYTES) throw new Error('IMAGE_PROVIDER_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID'); }
  }
  // Test doubles may expose only Response.json; real network fetch has a body stream.
  try { return await response.json(); }
  catch { throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID'); }
}

/** A configured provider is usable, but does NOT attest its internal effective model. */
export function validateGptImageCapability(record, model = 'gpt-image-2.5-sunburst') {
  const requested = ownData(record, 'modelRequested');
  if (ownData(record, 'available') !== true ||
      ownData(record, 'provider') !== 'openai' ||
      ownData(record, 'routeObserved') !== 'gpt-image' ||
      ownData(record, 'transportConfigured') !== true ||
      ownData(record, 'paidAuthorized') !== true ||
      ownData(record, 'imageGenCallable') !== true ||
      ownData(record, 'modelObserved') !== null ||
      !MODELS.has(model) || requested !== model) {
    return unavailable('IMAGE_PROVIDER_UNAVAILABLE');
  }
  return { available: true, reasonCode: 'IMAGE_PROVIDER_CONFIGURED', provider: 'openai',
    routeObserved: 'gpt-image', modelRequested: requested, modelObserved: null,
    transportConfigured: true, paidAuthorized: true, imageGenCallable: true };
}

/**
 * OpenAI Images API is a separate image-producing agent. Its request model is NOT
 * evidence of which hidden model executed the job. No API call occurs in probe.
 */
export function createOpenAIImageHost({ apiKey = process.env.OPENAI_API_KEY,
  allowPaid = process.env.LUDORY_IMAGE_ALLOW_PAID === '1',
  fetchImpl = globalThis.fetch, quality = 'high', size = '1536x864' } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n\0]/.test(apiKey) ||
      allowPaid !== true || typeof fetchImpl !== 'function') return null;
  if (!['auto', 'medium', 'high', 'xhigh', 'max'].includes(quality) ||
      !/^\d{3,4}x\d{3,4}$/.test(size)) throw new Error('IMAGE_PROVIDER_CONFIGURATION_INVALID');
  const token = apiKey.trim();
  return {
    async probe({ model = 'gpt-image-2.5-sunburst' } = {}) {
      if (!MODELS.has(model)) return { gptImage: unavailable('IMAGE_PROVIDER_MODEL_UNAVAILABLE') };
      return { gptImage: { available: true, provider: 'openai', routeObserved: 'gpt-image',
        transportConfigured: true, paidAuthorized: true, imageGenCallable: true,
        modelRequested: model, modelObserved: null } };
    },
    async generate({ model = 'gpt-image-2.5-sunburst', prompt, maxImages = 1, signal } = {}) {
      if (!MODELS.has(model)) throw new Error('IMAGE_PROVIDER_MODEL_INVALID');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32_000 ||
          !Number.isSafeInteger(maxImages) || maxImages < 1 || maxImages > 4) {
        throw new Error('IMAGE_PROVIDER_REQUEST_INVALID');
      }
      // n=1 prevents a single --apply from silently charging for several variants.
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, quality, size, output_format: 'png' }),
        signal,
      });
      if (!response || response.ok !== true) throw new Error('IMAGE_PROVIDER_HTTP_FAILED');
      const contentLength = response.headers?.get?.('content-length');
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) throw new Error('IMAGE_PROVIDER_RESPONSE_TOO_LARGE');
      const result = await boundedJson(response);
      if (!result || !Array.isArray(result.data) || result.data.length !== 1) {
        throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID');
      }
      const encoded = result.data[0]?.b64_json;
      if (typeof encoded !== 'string' || encoded.length < 4 || encoded.length % 4 !== 0 ||
          encoded.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 4) {
        throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID');
      }
      // Buffer's re-encoding below rejects non-canonical/invalid alphabets, including whitespace.
      // Avoid a group-repetition regex: multi-megabyte valid payloads exhaust V8's regex stack.
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
        throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID');
      }
      return { status: 'HOST_OBSERVED', provider: 'openai', routeObserved: 'gpt-image',
        modelRequested: model, modelObserved: null,
        images: [{ bytes, mediaType: 'image/png' }] };
    },
  };
}

/** A capability is meaningful only as an observation from a trusted in-process host adapter. */
export function validateImageCapability(record, model) {
  if (ownData(record, 'available') !== true ||
      ownData(record, 'transportVerified') !== true ||
      ownData(record, 'entitlementVerified') !== true ||
      ownData(record, 'imageGenCallable') !== true ||
      ownData(record, 'routeObserved') !== 'image-gen' ||
      ownData(record, 'attestationScope') !== 'live-execution-context' ||
      !(model === 'terra' ? /^gpt-\d+(?:\.\d+)?-terra$/i : /^gpt-\d+(?:\.\d+)?-sol$/i)
        .test(ownData(record, 'modelObserved') ?? '')) {
    return unavailable('IMAGE_HOST_CAPABILITY_UNVERIFIED');
  }
  return { available: true, reasonCode: 'AVAILABLE', transportVerified: true,
    entitlementVerified: true, imageGenCallable: true, routeObserved: 'image-gen',
    attestationScope: 'live-execution-context', modelObserved: ownData(record, 'modelObserved') };
}

/** No default provider: the ChatGPT Image Gen tool does not attest Terra/SOL. */
export async function discoverImageHost(host, model = 'gpt-image-2.5-sunburst') {
  const missing = { imageGpt: unavailable('IMAGE_PROVIDER_UNAVAILABLE'),
    imageTerra: unavailable('IMAGE_HOST_UNAVAILABLE'), imageSol: unavailable('IMAGE_HOST_UNAVAILABLE') };
  if (!host || typeof ownData(host, 'probe') !== 'function' ||
      typeof ownData(host, 'generate') !== 'function') return missing;
  let observed;
  try { observed = await host.probe({ model }); }
  catch { return missing; }
  return { imageGpt: validateGptImageCapability(ownData(observed, 'gptImage'), model),
    imageTerra: validateImageCapability(ownData(observed, 'terra'), 'terra'),
    imageSol: validateImageCapability(ownData(observed, 'sol'), 'sol') };
}
