import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Match OS filesystem paths, never a URL pathname that retains percent escaping. */
export function isF5b3DirectInvocation(argvScript, moduleUrl, platform = process.platform) {
  if (typeof argvScript !== 'string' || !argvScript) return false;
  const windows = platform === 'win32';
  const filesystem = windows ? path.win32 : path.posix;
  const normalize = filename => filesystem.normalize(filesystem.resolve(filename));
  const invoked = normalize(argvScript);
  const moduleFile = normalize(fileURLToPath(moduleUrl, { windows }));
  return windows ? invoked.toLowerCase() === moduleFile.toLowerCase() : invoked === moduleFile;
}
