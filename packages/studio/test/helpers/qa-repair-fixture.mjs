import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { planCreate, applyCreatePlan } from '../../src/scaffold.mjs';
import { planQaWebReview } from '../../src/qa-review-contract.mjs';
import { executeQaWebReview } from '../../src/qa-review.mjs';
import { makeQaReviewFixture, qaObservedResponse } from './qa-review-fixture.mjs';

// The host is deliberately synthetic: these tests verify local contracts, never live Web attestation.
export async function makeQaRepairFixture(t, { severity = 'P1' } = {}) {
  const input = makeQaReviewFixture(t);
  const gameDir = path.join(input.folder, 'game');
  fs.mkdirSync(gameDir);
  const project = fs.realpathSync.native(gameDir);
  const create = planCreate(project, { id: 'repair-game', title: 'Repair Game', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games'] });
  assert.equal(create.status, 'READY');
  assert.equal(applyCreatePlan(create).status, 'APPLIED');
  const { host } = await recordFakeReview(input, severity);
  return { ...input, project, reviewOutput: input.outputDir,
    repairOutput: path.join(input.folder, 'repair-consent'), host };
}

async function recordFakeReview(input, severity, description = 'Text is clipped') {
  const plan = planQaWebReview(input);
  assert.equal(plan.status, 'READY');
  const host = {
    async probe() { return { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
      modelRouteAvailable: 'chatgpt-web/gpt-6-sol-instant', reasoningRequired: 'low',
      browserObservationV2Available: true, preflight: { authenticated: true, newChat: true,
        solAvailable: true, url: 'https://chatgpt.com/c/contract-test' } }; },
    async turn(request) {
      const image = plan.images.find(row => row.ref === request.images[0].ref);
      const response = qaObservedResponse(image, request.taskId);
      if (image.id === 'mobile-390x844' && severity) response.text = JSON.stringify({
        schemaVersion: 1, imageSha256: image.sha256, imageVisible: true,
        verdict: 'ISSUES_FOUND', summary: description, findings: [{
          severity, category: 'visual-ux', description, evidence: 'Mobile screenshot',
          expected: 'Whole choice visible', observed: 'Bottom clipped',
          reproductionSteps: ['Open mobile portrait'],
        }],
      });
      return response;
    },
  };
  const review = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(review.status, severity ? 'ISSUES_FOUND' : 'REVIEWED');
  return { host, review };
}

export async function makeQaRepairRecheck(t, { severity = null, sourceText = 'console.log("fixed")',
  target = 'yandex-games', description = 'Text is clipped' } = {}) {
  const input = makeQaReviewFixture(t, target, { sourceText });
  const { review } = await recordFakeReview(input, severity, description);
  return { ...input, reviewOutput: input.outputDir, review };
}
