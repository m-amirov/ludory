import test from 'node:test';
import assert from 'node:assert/strict';
import { definePremiumManifest } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

test('validated sidecar obtains price from economy config and never modifies authored graph', () => {
  const { config, graph, rawManifest } = fixture();
  const saved = JSON.stringify(graph);
  const manifest = definePremiumManifest(rawManifest, { graph, economyConfig: config });
  assert.deepEqual(manifest.choices, [
    { beatId: 'fork', choiceId: 'intimate', contentId: 'private_time', cost: 12 },
  ]);
  assert.equal(Object.isFrozen(manifest.choices[0]), true);
  rawManifest.choices[0].contentId = 'garbage';
  assert.equal(manifest.choices[0].contentId, 'private_time');
  assert.equal(JSON.stringify(graph), saved);
});

test('invalid manifest schema, reference, content and duplicated mapping fail closed', () => {
  const { graph, config, rawManifest } = fixture();
  const invalid = [
    { ...rawManifest, schemaVersion: 2 },
    { ...rawManifest, extra: true },
    { ...rawManifest, choices: [{ beatId: 'missing', choiceId: 'intimate', contentId: 'private_time' }] },
    { ...rawManifest, choices: [{ beatId: 'fork', choiceId: 'missing', contentId: 'private_time' }] },
    { ...rawManifest, choices: [{ beatId: 'fork', choiceId: 'intimate', contentId: 'unknown' }] },
    { ...rawManifest, choices: [...rawManifest.choices, ...rawManifest.choices] },
    { ...rawManifest, choices: [{ ...rawManifest.choices[0], cost: 0 }] },
  ];
  for (const item of invalid) assert.throws(() => definePremiumManifest(item, { graph, economyConfig: config }), TypeError);
});

test('premium cannot cover all choices of an authored choice beat', () => {
  const { graph, config, rawManifest } = fixture();
  const allPremium = { ...rawManifest, choices: [...rawManifest.choices,
    { beatId: 'fork', choiceId: 'connect', contentId: 'private_time' },
    { beatId: 'fork', choiceId: 'leave', contentId: 'private_time' },
  ] };
  assert.throws(() => definePremiumManifest(allPremium, { graph, economyConfig: config }), /free choice/i);
});
