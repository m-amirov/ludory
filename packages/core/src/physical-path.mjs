import fs from 'node:fs';
import path from 'node:path';

/** Resolve NTFS short-name aliases without accepting symbolic-link or junction traversal. */
export function canonicalPhysicalDirectory(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('DIRECTORY_NOT_PHYSICAL');
    }
  }
  const canonical = fs.realpathSync.native(absolute);
  // POSIX lexical changes imply symbolic traversal. Windows realpath additionally
  // expands ordinary 8.3 directory aliases, which are not reparse points.
  if (process.platform !== 'win32' && canonical !== absolute) {
    throw new Error('DIRECTORY_NOT_PHYSICAL');
  }
  return canonical;
}
