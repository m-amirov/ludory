import { planPreviewBuild, buildPreview } from './preview-build.mjs';
import { startPreviewServer } from './preview-server.mjs';

function render(result, json, out) {
  if (json) { out(`${JSON.stringify(result, null, 2)}\n`); return; }
  out(`${result.status} · Ludory local preview · ${result.target ?? 'web'}\n`);
  if (result.url) {
    out(`  ${result.url}\n`);
    out(`  build SHA-256: ${result.buildSha256}\n`);
    out('  platform SDK evidence: NOT_RUN (local preview is not platform certification)\n');
    out(result.lan ? '  Connect devices to the same LAN/Wi-Fi; check local firewall and guest-network isolation.\n' :
      '  Loopback only. Add --lan to allow other devices on the private local network.\n');
    out('  Stop: Ctrl+C. Restart to rebuild after editing source.\n');
  } else if (result.reasonCode) out(`  blocked: ${result.reasonCode}\n`);
}

/** An explicitly started, temporary service; no mutation of game-owned paths. */
export async function runPreviewCli(flags, { out = text => process.stdout.write(text),
  err = text => process.stderr.write(text), signal } = {}) {
  const json = flags.has('--json');
  const project = flags.get('--project');
  const target = flags.get('--target') ?? 'web';
  const portValue = flags.get('--port') ?? '4173';
  if (!/^\d{1,5}$/.test(portValue) || Number(portValue) > 65535) {
    render({ status: 'FAILED', reasonCode: 'PREVIEW_PORT_INVALID' }, json, out);
    return 1;
  }
  const plan = planPreviewBuild(project, { target });
  if (plan.status !== 'READY') {
    render({ ...plan, status: 'BLOCKED' }, json, out);
    return 2;
  }
  if (signal?.aborted) {
    render({ status: 'BLOCKED', reasonCode: 'PREVIEW_CANCELLED' }, json, out);
    return 2;
  }
  const built = buildPreview(plan);
  if (built.status !== 'BUILT') {
    render(built, json, out);
    return 2;
  }
  let server;
  try {
    server = await startPreviewServer({ root: built.root, lan: flags.has('--lan'),
      port: Number(portValue), buildSha256: built.buildSha256 });
  } catch (error) {
    built.cleanup();
    render({ status: 'BLOCKED', reasonCode: error.message }, json, out);
    return 2;
  }
  let closing;
  const stop = () => {
    if (!closing) closing = server.close().finally(() => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      signal?.removeEventListener('abort', onAbort);
      built.cleanup();
    });
    return closing;
  };
  const onSignal = () => { void stop().catch(error => err(`Ludory preview cleanup: ${error.message}\n`)); };
  const onAbort = () => { void stop().catch(error => err(`Ludory preview cleanup: ${error.message}\n`)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) await stop();
  const result = { mode: 'preview', status: 'STARTED', project: plan.project,
    target, lan: flags.has('--lan'), url: server.url, address: server.address,
    port: server.port, sourceDigest: built.sourceDigest, buildSha256: built.buildSha256,
    sdkEvidence: 'NOT_RUN', platformModeration: 'NOT_RUN' };
  render(result, json, out);
  return 0;
}
