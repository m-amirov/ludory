import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** Require a single coherent monorepo version and exact internal pins before a freeze/tag. */
export function validateWorkspaceVersions(rootDir) {
  const root = path.resolve(rootDir);
  const manifest = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  const failures = [];
  const dirs = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() &&
      fs.existsSync(path.join(root, 'packages', entry.name, 'package.json')))
    .map(entry => entry.name).sort();
  const workspaces = dirs.map(dir => ({ dir, relative: `packages/${dir}`,
    manifest: readJson(path.join(root, 'packages', dir, 'package.json')) }));
  const byName = new Map(workspaces.map(item => [item.manifest.name, item]));

  if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
    failures.push(`lockfile root version does not match root ${manifest.version}`);
  }
  for (const item of workspaces) {
    if (item.manifest.version !== manifest.version) {
      failures.push(`${item.relative} version ${item.manifest.version} differs from root ${manifest.version}`);
    }
    const recorded = lock.packages?.[item.relative];
    if (!recorded || recorded.version !== item.manifest.version) {
      failures.push(`lockfile ${item.relative} version ${recorded?.version ?? 'missing'} differs from manifest ${item.manifest.version}`);
    }
    if (recorded?.name !== item.manifest.name) {
      failures.push(`lockfile ${item.relative} name ${recorded?.name ?? 'missing'} differs from manifest ${item.manifest.name}`);
    }
    const linkPath = `node_modules/${item.manifest.name}`;
    const linked = lock.packages?.[linkPath];
    if (!linked) {
      failures.push(`lockfile ${linkPath} workspace link missing`);
    } else if (linked.link !== true || linked.resolved !== item.relative) {
      failures.push(`lockfile ${linkPath} link/resolved mismatch: ${linked.resolved ?? 'missing'}; expected ${item.relative} and link:true`);
    }
  }
  for (const item of [{ relative: '(root)', manifest }, ...workspaces]) {
    for (const section of dependencySections) {
      for (const [name, requested] of Object.entries(item.manifest[section] ?? {})) {
        if (!name.startsWith('@ludory/')) continue;
        const dependency = byName.get(name);
        if (!dependency) {
          failures.push(`${item.relative} references unknown local package ${name}`);
        } else if (requested !== dependency.manifest.version) {
          failures.push(`${item.relative} ${name} requires ${requested}; expected ${dependency.manifest.version}`);
        }
      }
      const recorded = lock.packages?.[item.relative === '(root)' ? '' : item.relative];
      const pinned = recorded?.[section] ?? {};
      const declared = item.manifest[section] ?? {};
      for (const name of new Set([...Object.keys(declared), ...Object.keys(pinned)])) {
        if (!name.startsWith('@ludory/')) continue;
        if (declared[name] !== pinned[name]) {
          failures.push(`lockfile ${item.relative} ${name} pin ${pinned[name] ?? 'missing'} differs from manifest ${declared[name] ?? 'missing'}`);
        }
      }
    }
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const failures = validateWorkspaceVersions(root);
  for (const failure of failures) process.stderr.write(`VERSION_CONTRACT_FAILED: ${failure}\n`);
  if (failures.length) process.exitCode = 1;
  else process.stdout.write('WORKSPACE_VERSION_CONTRACT_PASS\n');
}
