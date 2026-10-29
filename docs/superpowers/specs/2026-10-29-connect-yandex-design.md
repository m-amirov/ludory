# Connect Yandex: архитектурная спецификация

Статус: **утверждена владельцем для планирования и реализации C1**. База: `origin/main` `a3e75d45c4ed6d4851f506d466d1b4580bfaf8aa` (Runtime R1–R7). Дата: 2026-10-29.

## 1. Назначение

Обеспечить запуск **новой** Ludory-игры внутри Яндекс Игр через поддерживаемый Yandex Games SDK: инициализацию, корректные события загрузки и gameplay, приостановку Runtime/аудио, облачные сохранения и рекламу. `@ludory/core` остаётся платформенно-нейтральным. Яндекс и VK получают независимые SDK, конфигурации и сборки. Старые игры, CEOS, Starter Kit и их evidence не изменяются.

Успех этапа C5: браузерный Yandex-specific пакет проходит автоматические контрактные проверки; отдельный draft в консоли Яндекс Игр реально наблюдался и результаты зафиксированы. **Контрактные mock-тесты не являются доказательством реального SDK, публикации или прохождения модерации**.

## 2. Рассмотренные подходы и выбор

| Подход | Выгода | Цена/риск | Решение |
| --- | --- | --- | --- |
| **A. Отдельный пакет, C1–C5, независимые PR** | Локализованные контракты и отказы, быстрый review, доказательства на каждом шаге | Потребуется поэтапная интеграция | **Выбран владельцем** |
| B. Один большой PR | Один интеграционный шаг | Большая область регрессии; сложнее обнаружить root cause | Не выбран |
| C. Только SDK/bootstrap | Самый маленький начальный scope | Нет сохранений, управления жизненным циклом, рекламы и платформенной приёмки | Не выбран |

## 3. Архитектурные границы и контракты

```
new Studio game entrypoint (Yandex build)
  ├─ @ludory/runtime → host, injected storage/audio/environment
  │   └─ @ludory/core → platform-neutral session/state
  ├─ @ludory/runtime-phaser → optional renderer, no SDK reference
  └─ @ludory/connect-yandex → SDK loading, lifecycle, storage, ads
```

- Новый workspace-пакет `packages/connect-yandex` (`@ludory/connect-yandex`, Node >=22, ESM, явные `exports`, без SDK npm-зависимости). Только Connect знает `YaGames`, `ysdk`, Player и рекламу.
- Загрузка SDK использует `/sdk.js` для Yandex-hosted archive, **не** удалённо скачанную копию; для собственного домена допускается явно настроенный абсолютный URL согласно официальным требованиям. В C1 тестируем инъецируемые `document`/`global` и SDK factory. Импорт пакета не трогает DOM и не вызывает SDK.
- `createYandexConnector({ sdkLoader?, initOptions?, timeoutMs? })` синхронно создаёт **экземпляр** с `initialize(): Promise<connection>`, `destroy(): Promise<void>` и `getStatus()`. `initialize()` — асинхронный bootstrap: один контролируемый загрузчик и один успешный `YaGames.init()` на экземпляр, явная обработка отсутствия SDK, timeout/ошибки скрипта/инициализации. Параллельные вызовы одного экземпляра получают один pending Promise. Возвращаемый frozen `connection` содержит `sdk` и нормализованные capabilities; статус `READY` наступает только после настоящей инициализации. После `FAILED`/`DESTROYED` повторная попытка требует **нового** экземпляра. `destroy()` отменяет/инвалидирует pending load и не допускает запоздалого перехода в READY.
- `detectYandexCapabilities(ysdk)` — структурная проверка доступных optional API (`loading`, `gameplay`, `player`, `fullscreenAds`, `rewardedAds`). Capability-флаги означают лишь доступность методов, **не право утверждать, что функция реально сработала**. Не определять возможности по user-agent.
- Ошибки Connect: предсказуемые коды `SDK_UNAVAILABLE`, `SDK_LOAD_FAILED`, `SDK_INIT_FAILED`, `SDK_TIMEOUT`, `CAPABILITY_UNAVAILABLE`, `PLAYER_UNAVAILABLE`, `CLOUD_SAVE_FAILED`, `CLOUD_LOAD_FAILED`, `CLOUD_CLEAR_FAILED`, `ADS_FAILED`, `ADS_NOT_SHOWN`; preserve `cause`, без фиктивного успеха. Не менять коды Runtime.
- Все Connect API допускают unit tests с fake SDK без `window`; публичные capability interfaces документируются в `README.md`. Реальная интеграция доступна только в Yandex entrypoint, не подключается глобально к обычному Runtime шаблону.

## 4. C1 — SDK Foundation

Создать `@ludory/connect-yandex` с импортируемой без DOM точкой входа, загрузчиком и инциализацией. В браузере script load, `YaGames.init` и обнаружение методов корректно последовательны; гонки двух одновременных `initialize` на одном connector экземпляре не загружают SDK дважды. Ошибка не оставляет обработчики/таймеры/инъецированные script-элементы; повторная попытка создаёт новое явное подключение. Не кэшировать один `ysdk` в вечном process-global singleton.

Проверки C1: success; unavailable API; script network error; deadline; rejected `init`; concurrent calls; `destroy` при pending load; SSR/Node import без DOM; negative input. E2E с настоящим Yandex SDK пока **не PASS**.

## 5. C2 — Lifecycle, audio и gameplay tagging

- Отдельный `createYandexLifecycle({ sdk, host, audio?, canResume? })` с явными `attach()`/`detach()`/`markReady()`. `markReady()` вызывает optional `ysdk.features.LoadingAPI.ready()` **после** `host.initialize()` и загрузки ресурсов, а не при старте скрипта.
- Статус `host.getStatus() === 'RUNNING'` соответствует настоящему gameplay. `GameplayAPI.start()`/`stop()` вызываются по изменениям host-status; повторная подписка, дубликаты и teardown не дают повторных ложных `start()`.
- `ysdk.on('game_api_pause', ...)` при реальном RUNNING ставит host на паузу и тем самым останавливает scheduler, input и звук. На `game_api_resume` восстановление допустимо **только если** пауза принадлежала платформе, host всё ещё PAUSED и callback `canResume` не запрещает resume. Ручная пауза, меню, STOPPED/FAULTED/DESTROYED, пользовательский mute и пауза приложения не сбрасываются.
- **Решение исполнителя:** lifecycle предоставляет обязательный для меню/ручных pause action метод `setManualPaused(boolean)`. При `true` platform resume никогда не запускает host; при `false` не происходит самовольного `resume()` до разрешённого платформенного события/явного действия игры. Опциональный `canResume()` — дополнительная проверка, не замена ручного флага. Прямой `host.pause()` во время уже активной platform pause не является наблюдаемым событием Runtime и без этого сигнала **неотличим**. Это фиксируется в интеграционном контракте и тестах, а не скрывается эвристикой.
- Ошибки optional platform features логируются/возвращаются как деградация Connect, без фиктивного Runtime FAULTED; ошибочный `host.pause()`/`resume()` не должен превращаться в неподтверждённый PASS.

Проверки C2: manual-before-platform, manual-during-platform, rapid pause/resume, double attach/detach, terminal host, missing features, audio not resumed after manual pause, loading-ready timing, BFCache/page lifecycle compatibility.

## 6. C3 — cloud saves

- `createYandexPlayerStorage({ getPlayer, namespace })` реализует уже существующий `RuntimeStorage` (`load(key)`, `save(key, record)`, `clear(key)`, возвращают Promises). `getPlayer(): Promise<Player>` — асинхронный provider, обычно `() => sdk.getPlayer()`; первый вызов только при storage operation, успешный Player кешируется на время адаптера, отказ не превращается в вечный cache и допускает последующий явный retry. `host.save()` продолжает создавать и проверять SHA-256 envelope, SDK не получает сырой `Core state` от рендера.
- Namespace game-specific и versioned, ключи детерминированы; в облако передаётся **один** целый `PersistedRecord V1`, без переписывания чужих ключей. `player.getData([cloudKey])`; `player.setData({ [cloudKey]: record }, true)` для явного `flush`. Без `flush:true` resolved Promise означает только постановку в очередь, не облачную запись.
- Предполагаемый предел SDK — **200 КБ суммарных данных на игрока**, не лимит одного Ludory record. Коннектор проверяет размер своего JSON в UTF-8 до запроса, но не может гарантировать место под другие SDK-данные; quota/rate-limit/network failures остаются отказами.
- `clear()` выставляет `null` для собственного ключа с `flush:true` (сознательно документированная семантика tombstone, без удаления других ключей); `load()` возвращает `null` для отсутствующего или `null` значения. `getPlayer()` выполняется лениво через provider и лишь при попытке облачного действия, если сессия/доступ это позволяют.
- При гостевом режиме, недоступном Player API, превышении лимита, отказе в доступе или сети — видимый `PLAYER_UNAVAILABLE`/`CLOUD_*_FAILED`. **Нет автоматической бесшумной подмены облачного хранилища на localStorage**, облако никогда не перезаписывает локальный save без явной политики игры. Локальный `createBrowserStorage` может быть отдельно выбран entrypoint как offline storage, но объединение/конфликт-разрешение и миграция — будущий opt-in.
- Не использовать данные профиля/имена/ID игрока без необходимости, не инициировать авторизацию ради теста, не логировать содержимое save.

Проверки C3: valid round trip; key isolation; omitted/no-value; corrupt hash/incompatible schema (через Runtime); quota/rate limit; `getPlayer` отказ; flush `true`; save/restore concurrency; no destructive fallback.

## 7. C4 — полноэкранная и rewarded-реклама

- `createYandexAds({ sdk, host, lifecycle })`: explicit `showFullscreen()` и `showRewarded()`; pause только на `onOpen`, продолжение только если это позволено lifecycle/manual state, finally/cleanup при `onClose` и `onError`.
- Rewarded возвращает `rewarded: true` **только после** достоверного `onRewarded`; `onClose` без `onRewarded` не выдаёт награду. Защита от повторных callbacks, double trigger, late callback после teardown, missing SDK и ad errors; статус `not shown` не маскируется как показ.
- Не добавлять рекламные вызовы в Runtime/core/render-loop и не запускать рекламу автоматически при загрузке. Privacy/consent и cooldown подчиняются Яндекс SDK/правилам платформы, отдельно проверяются в live draft.

Проверки C4: onOpen/onClose, onError, no-show, reward/no-reward, duplicate callbacks, manual pause ownership, lifecycle teardown, SDK feature unavailable.

## 8. C5 — build, browser E2E и независимое evidence

- Отдельный Yandex-only entrypoint/template и статическая сборка (через существующий `esbuild`, без смешения c VK). `index.html` подключает SDK по `/sdk.js` перед `YaGames.init()`; для локального браузерного smoke fake loader/SDK подключается только в test fixture, не в production bundle.
- Упаковка из нового game project должна содержать требуемые HTML/JS/assets и SDK contract, не включать SDK-копию, frozen game manifests, `.codex-os`/CEOS evidence или исходники development tests.
- Browser tests: Chromium/Firefox/WebKit + mobile emulations там, где CI позволяет; проверяются `host`/SDK status correlation, touch, fullscreen lifecycle, audio suspend, save round trip, Phaser renderer integration и отсутствие чужих SDK. Моки дают **SDK_CONTRACT_PASS**, а не `YANDEX_LIVE_PASS`.
- Реальный draft в Консоли Яндекс Игр: загрузить archive по отдельному разрешению владельца, запустить SDK с debug panel и зафиксировать observed init/LoadingAPI/GameplayAPI/pause-resume/audio/player save/ads на поддерживаемых браузерах и устройствах. Отсутствующее физическое устройство, авторизация, собственный Yandex account или реальная ad inventory => `BLOCKED` соответствующего пункта, а не фиктивный PASS.
- Публикация, модерация, релизные ZIP и Release certification в **отдельной фазе Release**, только по явному поручению владельца.

## 9. Последовательность PR и границы приёмки

| Этап | Готовая проверяемая поставка | Независимый gate |
| --- | --- | --- |
| C1 | Пакет, loader/init/capabilities/errors | Unit/contract tests, Node import, CI exact HEAD |
| C2 | Lifecycle bridge, ready/gameplay markers, audio | Manual/platform pause matrix, browser fixture |
| C3 | Player storage и envelope round trip | Fake SDK + Runtime compatibility, failure matrix |
| C4 | Fullscreen/rewarded bridge | Callback matrix + reward anti-fraud controls |
| C5 | Yandex entrypoint/build и browser acceptance | Automated SDK contract evidence + **separate** real draft evidence |

Каждый PR создаётся на собственной ветке в `LUDORY/.worktrees`, тестируется на актуальном HEAD, проходит review. Merge только после независимой приёмки и разрешения владельца. CI success без наблюдения live SDK не даёт платформенного или release PASS.

## 10. Проверки и известные риски

- На каждом PR: `node --test packages/connect-yandex/test/*.test.mjs` (когда пакет существует), `npm test`, `npm run check`, `node examples/core-session.mjs`; дополнительные браузерные E2E при C2/C5. Актуализировать root `test/check` scripts только при добавлении соответствующей проверки, не ослаблять их.
- SDK contract может меняться; закрепить ссылки на официальную документацию и дату проверки, обновлять по мере C1–C5.
- R7 Runtime browser/device emulation ≠ физический Yandex mobile-client QA; это отдельный блок.
- `getPlayer` может быть недоступен гостю, `setData(flush:true)` может отклоняться и иметь rate limit, `game_api_pause` может прийти во время ручной паузы, реклама может не показаться: каждый случай имеет явный результат.
- C1 не требует изменения Core, Runtime, Phaser, Studio или старых проектов. Любая найденная необходимость изменить общий Runtime contract оформляется отдельным review с regression tests, без silent expansion.

## 11. Официальные источники (проверено 2026-10-29)

- SDK bootstrap и путь `/sdk.js`: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about.html
- LoadingAPI и GameplayAPI: https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
- События `game_api_pause`/`game_api_resume`: https://yandex.ru/dev/games/doc/ru/sdk/sdk-events
- Player/getData/setData/flush/limits: https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
- Fullscreen и rewarded ads: https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- Developer debug panel: https://yandex.ru/dev/games/doc/ru/console/debug-panel
