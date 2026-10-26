import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIImageHost, discoverImageHost } from '../src/image-host.mjs';
import { png } from './helpers/images.mjs';

const apiResponse = data => ({ ok: true, status: 200, json: async () => ({ data }) });

test('no key or no explicit paid authorization cannot enable GPT Image generation', async () => {
  assert.equal(createOpenAIImageHost({ apiKey: '', allowPaid: true }), null);
  assert.equal(createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: false }), null);
  assert.equal((await discoverImageHost(null)).imageGpt.available, false);
});

test('GPT Image probe is offline and never performs a paid generation', async () => {
  let calls = 0;
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async () => { calls++; throw new Error('network must not run in preflight'); } });
  const discovered = await discoverImageHost(host, 'gpt-image-2.5-sunburst');
  assert.equal(discovered.imageGpt.available, true);
  assert.equal(discovered.imageGpt.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(discovered.imageGpt.modelObserved, null);
  assert.equal(calls, 0);
});

test('separate GPT Image adapter posts an explicit Sunburst model and returns original PNG bytes', async () => {
  let calls = 0;
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/images/generations');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.Authorization, 'Bearer sk-test');
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'gpt-image-2.5-sunburst');
      assert.equal(body.quality, 'high');
      assert.equal(body.output_format, 'png');
      assert.equal(body.prompt, 'A story-bound lighthouse');
      assert.equal(body.n, 1);
      return apiResponse([{ b64_json: png.toString('base64') }]);
    } });
  const result = await host.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'A story-bound lighthouse', maxImages: 1 });
  assert.equal(calls, 1);
  assert.equal(result.status, 'HOST_OBSERVED');
  assert.equal(result.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(result.modelObserved, null, 'API response does not attest an effective model');
  assert.deepEqual(result.images[0].bytes, png);
});

test('explicit Flare pin never substitutes Sunburst', async () => {
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async (_url, request) => {
      assert.equal(JSON.parse(request.body).model, 'gpt-image-2.5-flare');
      return apiResponse([{ b64_json: png.toString('base64') }]);
    } });
  assert.equal((await discoverImageHost(host, 'gpt-image-2.5-flare')).imageGpt.available, true);
  assert.equal((await host.generate({ model: 'gpt-image-2.5-flare', prompt: 'Landscape', maxImages: 1 })).images.length, 1);
});

test('large valid base64 image responses decode without regex stack exhaustion', async () => {
  const image = Buffer.alloc(6_000_000, 0x23);
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async () => apiResponse([{ b64_json: image.toString('base64') }]) });
  const result = await host.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'Large original' });
  assert.deepEqual(result.images[0].bytes, image);
});

test('provider refuses malformed response, unsafe base64 and HTTP failures without another paid call', async () => {
  for (const response of [apiResponse([{ b64_json: 'nonsense!' }]),
    apiResponse([{ url: 'https://external.example/image.png' }]),
    { ok: false, status: 401, json: async () => ({ error: { message: 'sensitive server detail' } }) }]) {
    let calls = 0;
    const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
      fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(host.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'test', maxImages: 1 }),
      /IMAGE_PROVIDER_/);
    assert.equal(calls, 1);
  }
});

test('unknown requested model is rejected before any network call', async () => {
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async () => { throw new Error('network should not be contacted'); } });
  await assert.rejects(host.generate({ model: 'gpt-6-terra', prompt: 'test', maxImages: 1 }),
    /IMAGE_PROVIDER_MODEL_INVALID/);
});

test('oversized streamed provider payload is bounded before JSON parsing', async () => {
  let chunks = 0;
  const host = createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async () => ({ ok: true, status: 200,
      body: new ReadableStream({ pull(controller) {
        chunks++;
        controller.enqueue(Buffer.alloc(1024 * 1024));
      } }),
    }) });
  await assert.rejects(host.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'test' }),
    /IMAGE_PROVIDER_RESPONSE_TOO_LARGE/);
  assert.ok(chunks > 1);
});
