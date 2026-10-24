const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const fields = new Set(['schemaVersion', 'id', 'version', 'title', 'engine', 'targets']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate and detach platform-neutral project metadata. */
export function defineGame(input) {
  if (!isRecord(input)) throw new TypeError('game definition must be an object');
  for (const field of Object.keys(input)) {
    if (!fields.has(field)) throw new TypeError(`game definition has unknown field: ${field}`);
  }
  if (input.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');
  if (typeof input.id !== 'string' || !slugPattern.test(input.id)) {
    throw new TypeError('id must be a lowercase kebab-case slug');
  }
  if (typeof input.version !== 'string' || !semverPattern.test(input.version)) {
    throw new TypeError('version must be SemVer');
  }
  const prerelease = input.version.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1];
  if (prerelease?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new TypeError('version must be SemVer (numeric prerelease identifiers cannot have leading zeros)');
  }
  if (typeof input.engine !== 'string' || !slugPattern.test(input.engine)) {
    throw new TypeError('engine must be a lowercase kebab-case identifier');
  }
  if (!isRecord(input.title) || Object.keys(input.title).length === 0) {
    throw new TypeError('title must contain at least one localized string');
  }
  const title = {};
  for (const [lang, value] of Object.entries(input.title)) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang) || typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`title contains invalid locale or text: ${lang}`);
    }
    Object.defineProperty(title, lang, { value: value.trim(), enumerable: true, writable: true, configurable: true });
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new TypeError('targets must be a non-empty array');
  }
  const targets = [];
  const seen = new Set();
  for (const target of input.targets) {
    if (typeof target !== 'string' || !slugPattern.test(target)) {
      throw new TypeError('targets must be lowercase kebab-case identifiers');
    }
    if (seen.has(target)) throw new TypeError(`duplicate target: ${target}`);
    seen.add(target);
    targets.push(target);
  }

  return Object.freeze({
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    title: Object.freeze(title),
    engine: input.engine,
    targets: Object.freeze(targets),
  });
}
