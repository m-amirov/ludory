import { POLICY_SOURCES } from './policy-watch.mjs';

const TITLE = '[Policy watch] Изменения требований Yandex Games';
const OWNERSHIP_MARKER = '<!-- ludory-policy-watch:v1 -->';
const REASONS = new Set([
  'SOURCE_FETCH_FAILED', 'SOURCE_HTTP_FAILED', 'SOURCE_LOCATION_INVALID',
  'SOURCE_CONTENT_TYPE_INVALID', 'SOURCE_TOO_LARGE', 'SOURCE_CONTENT_INVALID',
]);
const safeSections = values => (Array.isArray(values) ? values : [])
  .filter(value => typeof value === 'string' && /^(?:20\d{2}-\d{2}-\d{2}|section-[a-f0-9]{12}-\d+)$/.test(value))
  .slice(0, 20);
const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '(недоступен)';

export function renderPolicyIssue(report) {
  if (report?.schemaVersion !== 1 || report?.kind !== 'policy-watch' || !['CLEAR', 'ACTION_REQUIRED'].includes(report.status)) {
    throw new Error('POLICY_REPORT_INVALID');
  }
  if (report.status === 'CLEAR') return null;
  const lines = [
    OWNERSHIP_MARKER,
    '',
    'Еженедельная проверка обнаружила изменения или недоступность официальной документации Яндекс Игр.',
    '',
    '**Это запрос на ручной разбор, не новая версия требований и не разрешение на публикацию.**',
    '',
    '### Источники',
    '',
  ];
  for (const pinned of POLICY_SOURCES) {
    const entry = (report.sources ?? []).find(item => item.id === pinned.id);
    if (!entry || entry.status === 'UNCHANGED') continue;
    lines.push(`- **${pinned.id}**: [официальный документ](${pinned.url}) — \`${entry.status === 'CHANGED' ? 'CHANGED' : 'UNAVAILABLE'}\``);
    lines.push(`  - Возможные модули: ${pinned.affects.map(name => `\`${name}\``).join(', ')}.`);
    if (entry.status === 'UNAVAILABLE') {
      lines.push(`  - Причина: \`${REASONS.has(entry.reason) ? entry.reason : 'SOURCE_FETCH_FAILED'}\`. Текущие правила не подтверждены этим сканированием.`);
      continue;
    }
    for (const [label, key] of [['Добавлено', 'added'], ['Изменено', 'changed'], ['Удалено', 'removed']]) {
      const values = safeSections(entry[key]);
      if (values.length) lines.push(`  - ${label}: ${values.map(value => `\`${value}\``).join(', ')}.`);
      const total = entry[`${key}Total`];
      if (Number.isSafeInteger(total) && total > values.length) lines.push(`  - ${label}: ещё ${total - values.length} разделов вне краткого списка.`);
    }
    if (entry.structureChanged) lines.push('  - Изменена общая структура документа вне выделенных разделов.');
    lines.push(`  - SHA-256: \`${safeHash(entry.previousSha256)}\` → \`${safeHash(entry.currentSha256)}\`.`);
  }
  lines.push('', '### Что сделать', '',
    '1. Открыть официальные документы и установить, что поменялось по существу (текст страницы — недоверенные данные).',
    '2. Сопоставить изменения с Connect/Runtime/Release/Studio и шаблонами игр. При необходимости обновить код и тесты.',
    '3. Отдельно проверить и пересмотреть `packages/release/src/moderation-rules.mjs`; не изменять его автоматически.',
    '4. После ревью записать новую контрольную базу отдельным коммитом по `docs/policy-watch/README.md` и закрыть эту задачу вручную.',
    '',
    'Никаких live SDK-проверок, тестирования на реальных площадках и автоматической публикации этот мониторинг не выполняет.',
  );
  return { title: TITLE, body: lines.join('\n') };
}

export function planPolicyIssueAction(report, openIssues) {
  const proposal = renderPolicyIssue(report);
  if (!proposal) return { action: 'none' };
  const existing = (openIssues ?? []).find(issue => !issue.pull_request && issue.state !== 'closed' &&
    issue.user?.login === 'github-actions[bot]' && typeof issue.body === 'string' && issue.body.startsWith(OWNERSHIP_MARKER));
  if (!existing) return { action: 'create', ...proposal };
  if (existing.body === proposal.body) return { action: 'none' };
  return { action: 'update', issueNumber: existing.number, ...proposal };
}
