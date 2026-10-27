const SHA = /^[a-f0-9]{64}$/;
const VERDICTS = new Set(['ACCEPT', 'REWORK', 'BLOCKED']);
const CATEGORIES = new Set(['continuity', 'choice', 'character', 'plot', 'dialogue',
  'pacing', 'romance', 'structure', 'other']);
const SEVERITIES = new Set(['P0', 'P1', 'P2']);

function fail() { throw new Error('REVIEW_REPORT_INVALID'); }
function keys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function bounded(value, max = 1200) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

/** Strict, independently reusable contract; does not interpret prose as instructions. */
export function validateNarrativeVerdict(value, draftText, draftSha256) {
  if (!keys(value, ['schemaVersion', 'draftSha256', 'verdict', 'summary', 'findings']) ||
      value.schemaVersion !== 1 || !SHA.test(draftSha256 ?? '') ||
      value.draftSha256 !== draftSha256 || !VERDICTS.has(value.verdict) ||
      !bounded(value.summary, 2000) || !Array.isArray(value.findings) ||
      value.findings.length > 20 || typeof draftText !== 'string') fail();
  let critical = false;
  const findings = value.findings.map(item => {
    if (!keys(item, ['severity', 'category', 'location', 'excerpt', 'description']) ||
        !SEVERITIES.has(item.severity) || !CATEGORIES.has(item.category) ||
        !bounded(item.location, 160) || typeof item.excerpt !== 'string' ||
        item.excerpt.length > 500 || !bounded(item.description, 1200)) fail();
    if (item.severity !== 'P2') {
      critical = true;
      if (item.excerpt.length < 3 || !draftText.includes(item.excerpt)) fail();
    } else if (item.excerpt && !draftText.includes(item.excerpt)) fail();
    return { severity: item.severity, category: item.category, location: item.location,
      excerpt: item.excerpt, description: item.description };
  });
  if (value.verdict === 'ACCEPT' && critical || value.verdict === 'REWORK' && !critical ||
      value.verdict === 'BLOCKED' && critical) fail();
  return { schemaVersion: 1, draftSha256, verdict: value.verdict,
    summary: value.summary, findings };
}

export function parseNarrativeVerdict(raw, draftText, draftSha256) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32 * 1024) fail();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail(); }
  return validateNarrativeVerdict(parsed, draftText, draftSha256);
}

export function blockedNarrativeVerdict(draftSha256, reason) {
  return { schemaVersion: 1, draftSha256, verdict: 'BLOCKED', summary: reason, findings: [] };
}
