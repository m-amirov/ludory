/** Fail closed: an incompatible or corrupt story save is never overwritten on boot. */
export async function restoreNarrativeSession({ host, storage, saveKey }) {
  let record = null;
  if (storage) {
    try {
      record = await storage.load(saveKey);
      if (record !== null) await host.restore();
    } catch {
      return 'BLOCKED';
    }
  }
  host.start();
  return record === null ? 'NEW' : 'RESTORED';
}
