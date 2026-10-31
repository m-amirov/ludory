# Connect Yandex C5 — локальная приёмка, 2026-10-31

**Scope:** только новый `yandex-runtime` Studio template, кандидатный ZIP и браузерная интеграция Runtime/Connect/optional Phaser. Базовый `main` — `0814d02880c8afdec863dae22a06f93d53551e3c` (C4, PR #50). Рабочая ветка: `feat/connect-yandex-c5`.

**Вердикт автоматизированного контракта: `SDK_CONTRACT_PASS`.** `YANDEX_LIVE_NOT_RUN`; это **не** приёмка Release, прав, рекламы в боевой сети или модерации Яндекс Игр.

## Проверенные гейты

| Gate / команда | Наблюдение | Статус |
| --- | --- | --- |
| `npm run check:yandex-template` | Зафиксированный esbuild-бандл совпадает побайтно, 46 777 байт | PASS |
| `node packages/studio/test/yandex-candidate.test.mjs` | 9/9, включая подделку host trust, неисполняемые/дублированные SDK-теги, Windows-reserved имена и no-overwrite | PASS |
| `node --test packages/studio/test/yandex-c5-evidence.test.mjs` | Запрещены `YANDEX_LIVE_PASS` и `RELEASE_READY` даже при подделке результата; аварийный JSON содержит `SDK_CONTRACT_FAIL` | PASS |
| `npm run check:c5-scripts` | Синтаксис двух сборщиков, JSON-evidence и двух браузерных тестов | PASS |
| `npm run smoke` в `packages/runtime/test/browser` | Существующие Runtime R6 и Connect C2 + новый C5 завершены с exit 0 | PASS |
| `LUDORY_C5_ARTIFACT_DIR=artifacts npm run smoke:yandex-c5` | Сгенерированная Studio-игра распакована из ZIP; фиктивный `/sdk.js` подаётся **только** локальным тестовым сервером | PASS |
| `npm run smoke` в `packages/runtime-phaser/test/browser` | Существующий Phaser R5 + новый C5 с Phaser 3.90.0 и touch emulation, реальный canvas/resize/teardown, exit 0 | PASS |
| `node --test packages/connect-yandex/test/*.test.mjs` | 7 файлов тестов, 0 ошибок | PASS |
| `npm test` после review fixes | 738 тестов: 725 PASS, 13 SKIP, 0 FAIL; Quality отдельно 18/18, exit 0 | PASS |
| `npm run check`; `node examples/core-session.mjs`; `git diff --check` | exit 0 | PASS |
| Удалённый GitHub Actions на C5 HEAD | PR и удалённый CI ещё не опубликованы на момент локальной проверки | NOT_RUN |

## Пятибраузерный SDK-contract evidence

Идентичный кандидат ZIP для всех браузеров: SHA-256
`ba33c05fc022ced437abab5a1f608ee395b1fef0b6e8e04578047c359054239e`.

| Браузер | Движок | Устройство | Результат |
| --- | --- | --- | --- |
| Chromium desktop | chromium | эмуляция: нет | `SDK_CONTRACT_PASS` |
| Firefox desktop | firefox | эмуляция: нет | `SDK_CONTRACT_PASS` |
| WebKit desktop | webkit | эмуляция: нет | `SDK_CONTRACT_PASS` |
| Android Chromium | chromium | Pixel 7 (эмуляция) | `SDK_CONTRACT_PASS` |
| iPhone WebKit | webkit | iPhone 13 (эмуляция) | `SDK_CONTRACT_PASS` |

Тест проверял инициализацию SDK/Loading API после mount, игровой input, audio/pause/manual/platform/ad ownership, отрицательные advertising callbacks, cloud-save/restore с flush, guest refusal, corrupt SHA и отсутствие ложной READY при недоступном `/sdk.js`. Исходный фиктивный SDK не попал в ZIP. Машинный отчёт находится в локальном игнорируемом файле `packages/runtime/test/browser/artifacts/yandex-c5-contract.json` и загружается артефактом CI при фактическом запуске workflow.

Optional Phaser: Chromium с сенсорной эмуляцией, Phaser 3.90.0, одно касание увеличило score до 1; после resize canvas стал 480 px, pause/resume аудио и platform/manual arbitration сработали; stop/destroy освободили canvas, поздний input заблокирован. Физический телефон не использовался.

## Ограничения и следующий авторизуемый этап

- **NOT_RUN** — настоящая загрузка ZIP в Yandex Console / draft ID / серверный `/sdk.js` и реальные SDK capabilities.
- **NOT_RUN** — облачный Player аккаунт, реальные рекламные показы и rewarded inventory, debug panel на хостинге, мобильное физическое оборудование.
- **NOT_RUN** — независимые release-gates и проверка прав на игровые ресурсы; `RELEASE_READY` не присвоен.
- **NOT_RUN** — реальный GitHub Actions для ещё не опубликованного C5 HEAD. Локальный запуск CI-эквивалентных команд не подтверждает зелёный GitHub check.
- Попытка полного `npm test` в ограниченном sandbox первоначально вернула `spawnSync ... EPERM` для дочернего Node процесса. Повтор без sandbox-ограничения прошёл с кодом 0 **без каких-либо изменений тестируемых исходников**. Это ограничение окружения, а не основание скрывать сбой.
- Независимый review первоначального `772a02b` нашёл три Important: локально подделываемое происхождение Studio, обход регулятора SDK через HTML и невозможные на NTFS тестовые имена. После review добавлены host-bound `verifyStudioOrigin`, строгая проверка исполняемых script-тегов, отдельная platform-neutral проверка имён и условные filesystem-тесты. Повтор на исправленном коде: 725 PASS, 13 SKIP, 0 FAIL; эмулированные браузеры 5/5 и Phaser PASS. Удалённый Windows CI пока `NOT_RUN`.
- Повторный review обнаружил, что HTML regex может принять `<script>` внутри `style`/`title`/`textarea` и HTML-атрибута. Вместо расширения чёрного списка подключён настоящий HTML5 AST (`parse5`, точная версия 8.0.1), сравниваются только исполняемые узлы `head`/`body`. Добавлены RED/GREEN регрессионные варианты. Полный повтор на заключительном исправлении: 725 PASS, 13 SKIP, 0 FAIL, Quality 18/18; Chromium/Firefox/WebKit и обе мобильные эмуляции PASS; Phaser C5 PASS.

Следующий отдельный шаг владельца после review C5: разрешить публикацию Draft PR и проверить удалённый CI на точном HEAD. Загрузка тестовой игры в Yandex Console требует самостоятельного разрешения; даже после неё публикация игры остаётся отдельным решением.
