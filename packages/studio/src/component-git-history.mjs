import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const fullSha = /^[a-f0-9]{40}$/;
const maxCommits = 64;
const maxGitOutput = 8 * 1024 * 1024;
const maxEvidenceBytes = 64 * 1024 * 1024;
const evidenceNames = ['ludory.studio.json', 'ludory.project.json', 'ludory.components.json'];

function git(cwd, args, maxBytes = maxGitOutput) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '',
    GIT_PROTOCOL_FROM_USER: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' };
  for (const name of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(name) ||
        ['GIT_EXTERNAL_DIFF', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
          'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'].includes(name)) delete env[name];
  }
  const proc = spawnSync('git', ['--no-lazy-fetch', '-C', cwd, '--no-pager',
    '-c', 'core.fsmonitor=false', ...args], {
    env, encoding: 'buffer', timeout: 15000, maxBuffer: maxBytes + 1,
  });
  if (proc.error || proc.status !== 0 || !Buffer.isBuffer(proc.stdout) || proc.stdout.length > maxBytes) {
    throw new Error(`Git evidence unavailable or invalid (${args[0]}): ${proc.error?.message ?? proc.stderr?.toString('utf8').trim() ?? 'unknown'}`);
  }
  return proc.stdout;
}

function textGit(cwd, args, maxBytes) {
  return git(cwd, args, maxBytes).toString('utf8').trim();
}

function relativeProject(project, repositoryRoot) {
  const relative = path.relative(repositoryRoot, project);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Studio project escapes its Git repository');
  }
  return relative.split(path.sep).join('/');
}

function gitEntries(repositoryRoot, commit, projectPath) {
  // `ls-tree` alone is not reliable evidence: a corrupt loose tree can be
  // stored under an unchanged object name, breaking the commit -> blob link.
  // Verify each raw tree's SHA-1 before interpreting any of its entries.
  const { tree } = actualCommit(repositoryRoot, commit);
  let treeBytes = 0, treeEntries = 0;
  function readTree(sha) {
    const raw = git(repositoryRoot, ['cat-file', 'tree', sha]);
    treeBytes += raw.length;
    if (treeBytes > maxGitOutput) throw new Error('Git tree evidence exceeds byte limit');
    const actual = crypto.createHash('sha1').update(Buffer.from(`tree ${raw.length}\0`))
      .update(raw).digest('hex');
    if (actual !== sha) throw new Error('Committed Git tree object hash differs from its ID');
    const items = [];
    const names = new Set();
    for (let offset = 0; offset < raw.length;) {
      const separator = raw.indexOf(0x20, offset);
      const terminator = raw.indexOf(0, separator + 1);
      if (separator < offset || terminator < separator + 2 || terminator + 21 > raw.length) {
        throw new Error('Invalid committed Git tree entry');
      }
      const mode = raw.subarray(offset, separator).toString('ascii');
      const nameBytes = raw.subarray(separator + 1, terminator);
      const name = nameBytes.toString('utf8');
      if (!Buffer.from(name, 'utf8').equals(nameBytes) || !name || name === '.' ||
          name === '..' || name.includes('/') || name.includes('\\') || names.has(name) ||
          !['40000', '100644', '100755', '120000', '160000'].includes(mode)) {
        throw new Error('Unsafe committed Git tree entry');
      }
      names.add(name);
      const child = raw.subarray(terminator + 1, terminator + 21).toString('hex');
      items.push({ mode, name, sha: child });
      offset = terminator + 21;
      if (++treeEntries > 65536) throw new Error('Git tree entry count exceeds limit');
    }
    return items;
  }
  let subtree = tree;
  for (const segment of projectPath ? projectPath.split('/') : []) {
    const item = readTree(subtree).find(entry => entry.name === segment);
    if (!item || item.mode !== '40000') throw new Error('Missing committed Studio project directory');
    subtree = item.sha;
  }
  const all = new Map();
  function descend(sha, prefix = '', depth = 0) {
    if (depth > 64) throw new Error('Git tree nesting exceeds limit');
    for (const entry of readTree(sha)) {
      const relative = `${prefix}${entry.name}`;
      if (entry.mode === '40000') descend(entry.sha, `${relative}/`, depth + 1);
      else {
        if (all.has(relative)) throw new Error('Duplicate committed Git path');
        all.set(relative, { mode: entry.mode,
          type: entry.mode === '160000' ? 'commit' : 'blob', sha: entry.sha });
      }
    }
  }
  descend(subtree);
  return all;
}

function committedFile(repositoryRoot, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`Missing committed Studio file: ${name}`);
  if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') {
    throw new Error(`Unsafe Git mode (not a regular file): ${name}`);
  }
  const bytes = git(repositoryRoot, ['cat-file', 'blob', entry.sha], 2 * 1024 * 1024);
  const actual = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if (entry.sha !== actual) throw new Error(`Committed Git blob object hash differs from ID: ${name}`);
  return { mode: entry.mode, bytes };
}

function actualCommit(repositoryRoot, sha) {
  // `rev-list` can be lied to by the deprecated .git/info/grafts mechanism
  // even with GIT_NO_REPLACE_OBJECTS=1. Raw commit bytes retain real parents.
  const bytes = git(repositoryRoot, ['cat-file', 'commit', sha]);
  const actual = crypto.createHash('sha1').update(Buffer.from(`commit ${bytes.length}\0`))
    .update(bytes).digest('hex');
  if (actual !== sha) throw new Error('Committed Git object hash differs from its ID');
  const headers = bytes.toString('utf8').split('\n\n', 1)[0].split('\n');
  const parents = headers.filter(line => line.startsWith('parent '));
  const treeRows = headers.filter(line => line.startsWith('tree '));
  if (treeRows.length !== 1 || !/^tree [a-f0-9]{40}$/.test(treeRows[0])) {
    throw new Error('Invalid Git commit tree header');
  }
  if (parents.some(line => !/^parent [a-f0-9]{40}$/.test(line))) {
    throw new Error('Invalid Git commit parent header');
  }
  return { parents: parents.map(line => line.slice('parent '.length)),
    tree: treeRows[0].slice('tree '.length) };
}

/**
 * Offline, bounded Git witness. This is content evidence, never ownership
 * authority: a separate human consent and host-owned pin are mandatory.
 */
export function collectComponentGitHistory(projectDir, { fromCommit, toCommit } = {}) {
  if (![fromCommit, toCommit].every(value => typeof value === 'string' && fullSha.test(value))) {
    throw new Error('Recovery requires full lowercase 40-character commit SHA-1 IDs');
  }
  const project = fs.realpathSync.native(path.resolve(projectDir));
  if (!fs.lstatSync(project).isDirectory() || fs.lstatSync(path.resolve(projectDir)).isSymbolicLink()) {
    throw new Error('Unsafe Studio project directory');
  }
  const repositoryRoot = fs.realpathSync.native(textGit(project, ['rev-parse', '--show-toplevel']));
  const projectPath = relativeProject(project, repositoryRoot);
  if (textGit(repositoryRoot, ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Git recovery requires a complete non-shallow history');
  }
  for (const commit of [fromCommit, toCommit]) {
    if (textGit(repositoryRoot, ['rev-parse', '--verify', `${commit}^{commit}`]) !== commit) {
      throw new Error('Git recovery commit object does not match its full SHA');
    }
  }
  const lines = textGit(repositoryRoot, ['rev-list', '--first-parent', '--parents',
    `--max-count=${maxCommits + 1}`, toCommit], maxGitOutput).split('\n');
  const index = lines.findIndex(line => line.split(' ')[0] === fromCommit);
  if (index < 0 || index >= maxCommits) throw new Error('Recovery source is not in bounded first-parent Git history');
  const selected = lines.slice(0, index + 1);
  for (let i = 0; i < selected.length - 1; i++) {
    const tokens = selected[i].split(' ');
    const realParents = actualCommit(repositoryRoot, tokens[0]).parents;
    if (tokens.length !== 2 || realParents.length !== 1 ||
        tokens[1] !== selected[i + 1].split(' ')[0] || realParents[0] !== tokens[1]) {
      throw new Error('Ambiguous first-parent Git history (merge or broken ancestor)');
    }
  }
  actualCommit(repositoryRoot, fromCommit); // Integrity of the source commit object.
  let evidenceBytes = 0;
  const commits = [];
  for (const line of selected.reverse()) {
    const sha = line.split(' ')[0];
    const entries = gitEntries(repositoryRoot, sha, projectPath);
    const files = new Map();
    for (const name of evidenceNames) files.set(name, committedFile(repositoryRoot, entries, name));
    let state;
    try { state = JSON.parse(files.get('ludory.components.json').bytes.toString('utf8')); }
    catch { throw new Error(`Invalid committed component state at ${sha}`); }
    if (!state?.files || typeof state.files !== 'object' || Array.isArray(state.files) ||
        Object.keys(state.files).length > 4096) throw new Error(`Invalid committed managed file map at ${sha}`);
    for (const name of Object.keys(state.files)) {
      if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') ||
          name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Unsafe committed managed file path: ${name}`);
      }
      files.set(name, committedFile(repositoryRoot, entries, name));
    }
    evidenceBytes += [...files.values()].reduce((total, file) => total + file.bytes.length, 0);
    if (evidenceBytes > maxEvidenceBytes) throw new Error('Git component recovery evidence exceeds byte limit');
    commits.push({ sha, files });
  }
  return { repositoryRoot, projectPath, commits };
}
