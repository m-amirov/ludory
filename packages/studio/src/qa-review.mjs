import { planQaWebReview, readQaImage, qaImagePrompt, parseQaImageVerdict,
  verifyQaImageObservation } from './qa-review-contract.mjs';
import { beginQaJournal, appendQaJournal, inspectQaJournal } from './qa-review-journal.mjs';

const own = (record, key) => {
  try {
    const descriptor = record && typeof record === 'object' && !Array.isArray(record)
      ? Object.getOwnPropertyDescriptor(record, key) : null;
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
};

const safeCap = cap => {
  const preflight = own(cap, 'preflight');
  return own(cap, 'available') === true && own(cap, 'reasonCode') === 'AVAILABLE' &&
    own(cap, 'routeAvailable') === 'web-dev' &&
    own(cap, 'modelRouteAvailable') === 'chatgpt-web/gpt-6-sol-instant' &&
    own(cap, 'reasoningRequired') === 'low' &&
    own(cap, 'browserObservationV2Available') === true &&
    own(preflight, 'authenticated') === true && own(preflight, 'newChat') === true &&
    own(preflight, 'solAvailable') === true &&
    typeof own(preflight, 'url') === 'string' && Boolean(own(preflight, 'url'));
};

const sameSnapshot = (previous, fresh) => fresh?.status === 'READY' &&
  previous?.status === 'READY' && previous.target === fresh.target &&
  previous.candidateSha256 === fresh.candidateSha256 &&
  previous.captureReportSha256 === fresh.captureReportSha256 &&
  previous.metadataSha256 === fresh.metadataSha256 &&
  JSON.stringify(previous.images) === JSON.stringify(fresh.images) &&
  JSON.stringify(previous.packet) === JSON.stringify(fresh.packet) &&
  JSON.stringify(previous.sourceOptions) === JSON.stringify(fresh.sourceOptions);

const result = (plan, status, reasonCode, extras = {}) => ({ schemaVersion: 1,
  kind: 'qa-web-review', status, reasonCode, target: plan?.target ?? null,
  candidateSha256: plan?.candidateSha256 ?? null,
  captureStatus: plan?.captureStatus ?? null,
  browserAttested: false, reviewProvenance: 'NOT_RUN',
  actualModeration: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
  findings: [], images: [], ...extras });

/** Never transmits without explicit apply; exactly one original per attested turn. */
export async function executeQaWebReview(plan, { apply = false, outputDir, host = null } = {}) {
  if (!apply || plan?.status !== 'READY') return plan;
  if (!plan || plan.kind !== 'qa-web-review-plan' || !plan.sourceOptions ||
      !Array.isArray(plan.images) || plan.images.length !== 5) {
    return result(plan, 'BLOCKED', 'QA_REVIEW_PLAN_INVALID');
  }
  const replan = () => planQaWebReview(plan.sourceOptions);
  if (!sameSnapshot(plan, replan())) return result(plan, 'BLOCKED', 'QA_REVIEW_SOURCE_CHANGED');
  if (!host || typeof host.probe !== 'function' || typeof host.turn !== 'function') {
    return result(plan, 'BLOCKED', 'QA_REVIEW_HOST_UNAVAILABLE');
  }
  const pending = (code, output, images = []) => result(plan, 'PENDING_RECOVERY', code,
    { outputDir: output, images, nextAction: { kind: 'CONFIRM_REVIEWER_STOPPED', executable: false },
      warning: 'The isolated reviewer may have completed an uncertain turn. Do not automatically retry; a confirmed restart sends all five original images again.' });
  let started;
  const observed = [];
  try {
    let cap;
    try { cap = await host.probe(); }
    catch { return result(plan, 'BLOCKED', 'QA_REVIEW_HOST_UNVERIFIED'); }
    if (!safeCap(cap)) return result(plan, 'BLOCKED', 'QA_REVIEW_HOST_UNVERIFIED');
    if (!sameSnapshot(plan, replan())) return result(plan, 'BLOCKED', 'QA_REVIEW_SOURCE_CHANGED');
    try { started = beginQaJournal(outputDir, plan); }
    catch (error) { return result(plan, 'BLOCKED', error.code?.startsWith('QA_') ? error.code : 'QA_JOURNAL_CREATE_FAILED'); }
    for (const [imageIndex, image] of plan.images.entries()) {
      if (!sameSnapshot(plan, replan())) {
        return pending('QA_REVIEW_SOURCE_CHANGED', started.outputDir, observed);
      }
      let bytes;
      try { bytes = readQaImage(image); }
      catch { return pending('QA_REVIEW_IMAGE_CHANGED', started.outputDir, observed); }
      const traceId = `qa-${started.sessionId}-${imageIndex}`;
      // The intent must be on disk BEFORE a potentially chargeable Web upload.
      try { appendQaJournal(started.outputDir, { type: 'REQUESTED', imageIndex, traceId,
        imageSha256: image.sha256 }); }
      catch { return pending('QA_JOURNAL_INTENT_UNCOMMITTED', started.outputDir, observed); }
      let response;
      try {
        response = await host.turn({ prompt: qaImagePrompt(plan, image), taskId: traceId,
          images: [{ ref: image.ref, mimeType: image.mimeType, bytes, sha256: image.sha256 }] });
      } catch { return pending('QA_REVIEW_HOST_RESPONSE_UNCERTAIN', started.outputDir, observed); }
      if (!verifyQaImageObservation(response, image, traceId)) {
        return pending('QA_REVIEW_VISUAL_ATTESTATION_MISSING', started.outputDir, observed);
      }
      const parsed = parseQaImageVerdict(response.text, image);
      if (parsed.status === 'BLOCKED') return pending(parsed.reasonCode, started.outputDir, observed);
      try {
        appendQaJournal(started.outputDir, { type: 'OBSERVED', imageIndex, traceId,
          imageSha256: image.sha256, verdict: parsed.status, summary: parsed.summary,
          findings: parsed.findings, hostObservation: response.hostObservation });
      } catch { return pending('QA_JOURNAL_OBSERVATION_UNCOMMITTED', started.outputDir, observed); }
      observed.push({ id: image.id, kind: image.kind, sha256: image.sha256,
        verdict: parsed.status, summary: parsed.summary, findings: parsed.findings });
    }
    if (!sameSnapshot(plan, replan())) {
      return pending('QA_REVIEW_SOURCE_CHANGED', started.outputDir, observed);
    }
    const findings = observed.flatMap(item => item.findings.map(finding =>
      ({ ...finding, imageId: item.id, imageSha256: item.sha256 })));
    return result(plan, findings.length ? 'ISSUES_FOUND' : 'REVIEWED',
      'QA_REVIEW_FIVE_IMAGES_OBSERVED', { outputDir: started.outputDir,
        browserAttested: true, reviewProvenance: 'HOST_OBSERVED',
        images: observed, findings,
        warning: 'Independent pixels were observed in this live session only; this does not establish moderation, rights or publication readiness.' });
  } finally {
    if (typeof host.close === 'function') {
      try { await host.close(); } catch { /* preserve review status */ }
    }
  }
}

/** A fresh review of all five files; prior editable audit records are never authority. */
export async function restartQaWebReview(options, { previousOutput, outputDir,
  confirmReviewerStopped = false, apply = false, host = null } = {}) {
  const previous = inspectQaJournal(previousOutput);
  const current = planQaWebReview(options);
  if (current.status !== 'READY') return current;
  if (previous.status !== 'PENDING_RECOVERY' || previous.candidateSha256 !== current.candidateSha256 ||
      previous.target !== current.target || previous.metadataSha256 !== current.metadataSha256 ||
      previous.captureReportSha256 !== current.captureReportSha256 ||
      JSON.stringify(previous.recordedInputImages) !== JSON.stringify(current.images)) {
    return result(current, 'BLOCKED', 'QA_REVIEW_RESTART_BINDING_INVALID');
  }
  if (!apply || !confirmReviewerStopped) return result(current, 'PENDING_RECOVERY',
    'QA_REVIEW_RESTART_CONFIRMATION_REQUIRED', {
      warning: 'Confirm the old reviewer is stopped; restart repeats all five original image uploads and may consume account quota.' });
  if (previousOutput === outputDir) return result(current, 'BLOCKED', 'QA_REVIEW_RESTART_OUTPUT_REQUIRED');
  return executeQaWebReview(current, { apply: true, outputDir, host });
}
