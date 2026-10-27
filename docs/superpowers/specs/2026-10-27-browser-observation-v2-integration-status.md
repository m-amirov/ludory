# Browser Observation v2 integration status

Дата: 2026-10-27

Область: Ludory PR #13, `feat/web-art-acceptance`

## Реализовано

- Ludory принимает для художественной приёмки только `browser_observation_v2`;
  `compatibility-v1` не используется как fallback.
- Observation проверяет один `traceId`, модель `chatgpt-web/gpt-6-sol`,
  reasoning `high`, SHA-256 и размер исходных байтов, завершение upload и
  видимый attachment chip.
- Receipt связывает verdict с импортированным файлом, его байтами и
  browser-observed контекстом.
- В изолированной сборке `codex-chatgpt-web` сохранена обратная совместимость
  `compatibility-v1`; helper v2 установлен только в DEV-профиль. Стабильный
  launcher и стабильный пользовательский профиль не изменялись.

## Web evidence

Первый реальный smoke завершился `REWORK` с P1. Это был дефект тестового
изображения, а не потеря контекста: receipt содержал совпадающие исходный
SHA/размер, модель, trace, `process_upload_stream`, `file.processing.completed`
и `visibleAttachmentChip`. Web отдельно указал на отсутствие узнаваемой
lantern room/beam, несоответствие rocky Icelandic winter coast и отклонение
от painterly cinematic style.

После подготовки нового проверенного 16:9 fixture проведён положительный
реальный Web Art Review:

- модель: `chatgpt-web/gpt-6-sol`, наблюдаемая модель `gpt-6-sol`;
- reasoning: `high`;
- trace: `art-2026-10-27T08-10-04-159Z-2cfca3ae441d`;
- изображение: 653829 байт,
  SHA-256 `62cc06cf207155b2ab6c9fc9cbb2d6b73a51f64c7f1c8e9a4d222205909be76e`;
- upload: `process_upload_stream`, `file.processing.completed`,
  `processingCompleted: true`, `visibleAttachmentChip: true`;
- verdict: `PASS_ART`, findings: `[]`;
- receipt:
  `C:\Users\user\AppData\Local\Temp\ludory-positive-web-e2e-pnwg1L\.ludory\ai\runs\2026-10-27T08-10-04-159Z-2cfca3ae441d\reviews\000001.json`;
- receipt SHA-256:
  `c0debf058a9bff60fbaca03861260529a0bb21fe1ff73898a950ec674ad93ae9`.

Этот Web PASS_ART подтверждает независимую browser-observed приёмку
проверенного fixture. Он не подтверждает ImageGen E2E и не является Release
PASS.

## Оставшиеся gates

Native Codex ImageGen в текущей сессии не разблокирован: run-scoped
`ceos capability-challenge --json` возвращает
`BLOCKED_SESSION_CONTEXT_UNVERIFIED`. Дополнительно `ceos context --skill
production-art --project .` не находит `.codex-os` manifest в изолированном
Ludory worktree. Это отдельный trusted-session/capability блокер, а не ошибка
маршрутизации Web: Web preflight и Web attachment smoke доступны.

Причина вызова `ceos capability-challenge` относится к обязательному
run-scoped trusted Codex gate production-art, а не к runtime Ludory. Ludory
сам не запускает CEOS: встроенный ImageGen оставляет source-bound handoff
`NEEDS_AGENT_ACTION`, а отдельный Codex image-generator должен вызвать
`$imagegen`. Подробный разбор границ и воспроизводимости helper-а находится в
[evidence audit](../../evidence/pr13-imagegen-capability-helper-supply-2026-10-27.md).

ImageGen не вызывался и синтетический output/receipt не создавался. Для
закрытия этого gate нужна новая доверенная Codex-сессия с доступным native
ImageGen и успешным run-scoped capability challenge; после этого требуется
свежая цепочка `brief -> ImageGen -> original -> Web Art Review -> receipt`.

PR #13 остаётся Draft. Внешний `codex-chatgpt-web` не обновлялся и merge в
`main` не выполнялся.
