import test from 'node:test';
import assert from 'node:assert/strict';

test('@ludory/ai package users cannot invoke privileged raw Store writers through its supported exports', async () => {
  const api = await import('@ludory/ai');
  for (const name of ['planNewRun', 'commitNewRun', 'planNativeEvent', 'commitNativeEvent']) {
    assert.equal(Object.hasOwn(api, name), false, `${name} escaped the package boundary`);
  }
  for (const name of ['readNativeRun', 'listNativeRuns', 'planWorkflow', 'executeWorkflow']) {
    assert.equal(typeof api[name], 'function', `${name} must remain supported`);
  }
  await assert.rejects(() => import('@ludory/ai/src/store.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
