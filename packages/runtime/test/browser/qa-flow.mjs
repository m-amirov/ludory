import { readRegularBytes, SHA_256, sha256 } from '../../../release/src/archive.mjs';

const kinds = new Set(['click', 'fill', 'expect-text', 'reload', 'browser-back']);
const selectorKinds = new Set(['click', 'fill', 'expect-text']);
const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/** A bounded declarative flow. It cannot execute scripts, change the candidate,
 * authorize release, or attest game-state coverage without explicit assertions. */
export function readQaFlow(flowPath, { target, candidateSha256 } = {}) {
  const bytes = readRegularBytes(flowPath, 64 * 1024);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { invalid('QA_FLOW_JSON_INVALID'); }
  if (!exactKeys(data, ['schemaVersion', 'target', 'candidateSha256', 'steps']) ||
      data.schemaVersion !== 1 || data.target !== target || !SHA_256.test(data.candidateSha256 ?? '') ||
      data.candidateSha256 !== candidateSha256) invalid('QA_FLOW_CANDIDATE_MISMATCH');
  if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 30) {
    invalid('QA_FLOW_STEPS_INVALID');
  }
  const steps = data.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || !kinds.has(step.kind)) {
      invalid('QA_FLOW_STEP_INVALID');
    }
    const required = step.kind === 'fill' ? ['kind', 'selector', 'text']
      : step.kind === 'expect-text' ? ['kind', 'selector', 'text']
        : step.kind === 'click' ? ['kind', 'selector'] : ['kind'];
    if (!exactKeys(step, required) ||
        (selectorKinds.has(step.kind) &&
         (typeof step.selector !== 'string' || !step.selector.trim() || step.selector.length > 200 ||
          /[\r\n\0]/.test(step.selector))) ||
        ((step.kind === 'fill' || step.kind === 'expect-text') &&
         (typeof step.text !== 'string' || !step.text.length || step.text.length > 1000))) {
      invalid('QA_FLOW_STEP_INVALID');
    }
    return Object.freeze({ ...step, index });
  });
  return Object.freeze({ steps: Object.freeze(steps), evidenceSha256: sha256(bytes) });
}

function sameOrigin(page, origin) {
  try { return new URL(page.url()).origin === origin; }
  catch { return false; }
}

export async function runQaFlow(page, flow, { origin, timeoutMs = 10000 } = {}) {
  if (!flow) return { status: 'NOT_RUN', steps: [] };
  const results = [];
  for (const step of flow.steps) {
    let outcome = 'PASS', reasonCode = 'QA_FLOW_STEP_OBSERVED';
    try {
      if (!sameOrigin(page, origin)) invalid('QA_FLOW_ORIGIN_CHANGED');
      if (step.kind === 'click') {
        await page.locator(step.selector).click({ timeout: timeoutMs });
      } else if (step.kind === 'fill') {
        await page.locator(step.selector).fill(step.text, { timeout: timeoutMs });
      } else if (step.kind === 'expect-text') {
        // Read DOM text and require the explicitly declared expected text.
        // No eval or arbitrary user script is executed by the flow contract.
        await page.waitForFunction(({ selector, text }) =>
          [...document.querySelectorAll(selector)].some(el => {
            if (!el.textContent?.includes(text) || el.closest('[hidden],[aria-hidden="true"]')) return false;
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              style.visibility !== 'collapse' && el.getClientRects().length > 0;
          }),
        { selector: step.selector, text: step.text }, { timeout: timeoutMs });
      } else if (step.kind === 'reload') {
        await page.reload({ waitUntil: 'load', timeout: timeoutMs });
      } else if (step.kind === 'browser-back') {
        const before = page.url();
        await page.goBack({ waitUntil: 'load', timeout: timeoutMs });
        // Same-document SPA/hash navigation legitimately returns a null HTTP
        // response; only unchanged browser history means no observed Back.
        if (page.url() === before) invalid('QA_FLOW_HISTORY_UNAVAILABLE');
      }
      if (!sameOrigin(page, origin)) invalid('QA_FLOW_ORIGIN_CHANGED');
    } catch (error) {
      outcome = 'FAIL';
      reasonCode = error.code === 'QA_FLOW_ORIGIN_CHANGED' || error.code === 'QA_FLOW_HISTORY_UNAVAILABLE'
        ? error.code : 'QA_FLOW_ASSERTION_FAILED';
    }
    results.push({ index: step.index, kind: step.kind, status: outcome, reasonCode });
    if (outcome !== 'PASS') break;
  }
  return { status: results.length === flow.steps.length && results.every(row => row.status === 'PASS')
    ? 'PASS' : 'FAIL', steps: results, evidenceSha256: flow.evidenceSha256 };
}
