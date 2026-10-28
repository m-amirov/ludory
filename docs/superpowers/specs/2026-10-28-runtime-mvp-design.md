# Runtime MVP: архитектурная спецификация

Статус: revision 2, архитектурные решения зафиксированы для review и начала R1 после отдельной проверки ветки. Реализация `@ludory/runtime`, Connect и Release этим документом не выполняется.

Основание: фактические API Core на `main` (`createGameSession`, `tick`, `snapshot`, `restore`) и аудит 2026-10-28. Эта редакция устраняет замечания P1 к первоначальному proposal. До реализации R1 проверить, что эти Core API не изменились в рабочей ветке.

## 1. Цель и границы

Новая игра, созданная через Ludory Studio, должна получить минимальный браузерный host, который одинаково работает на desktop и mobile viewport, использует `@ludory/core` для определения игры и состояния, но не смешивает Core с браузерными API, рендерингом, хранением или platform SDK.

Runtime MVP отвечает за:

- lifecycle host и игровой тик;
- подключение Core session/state;
- нормализованный пользовательский ввод;
- pause/resume;
- сохранение и восстановление versioned Core snapshot;
- viewport/device-class адаптацию;
- базовое управление звуком;
- engine-neutral renderer contract;
- независимый Phaser adapter.

Runtime MVP не отвечает за:

- SDK Яндекс.Игр или VK Games;
- авторизацию, рекламу, платежи, платформенные achievements;
- публикацию, release certification и live platform evidence;
- изменение Core API ради браузерного host;
- миграцию существующих игр или импорт CEOS history.

## 2. Границы пакетов

```text
@ludory/core
  definition, immutable/validated state snapshot, game session
        |
        v
@ludory/runtime
  host lifecycle, scheduler, input, persistence, viewport, audio contracts
        |
        +--> runtime renderer contract
        |
        +--> @ludory/runtime-phaser   (optional peer adapter)
        |
        +--> future @ludory/connect-yandex / @ludory/connect-vk
```

`@ludory/runtime` может использовать браузерные primitives только внутри Runtime boundary. Core остаётся импортируемым в Node и не получает `window`, `document`, Phaser, SDK или platform storage. Phaser должен быть peer dependency отдельного adapter package, чтобы engine-neutral host не становился Phaser-bound.

Выбран отдельный пакет `@ludory/runtime-phaser`, а не subpath `@ludory/runtime/phaser`. Оба пакета используют Node.js 22+ ESM и явные package `exports`. `@ludory/runtime` не импортирует Phaser даже транзитивно. Его публичные контракты можно импортировать и тестировать в Node без DOM.

## 3. Минимальные публичные контракты

Имена и семантика ниже — конкретное предложение к review; новая реализация не может менять эти границы молча.

### `createRuntimeHost`

```js
const host = createRuntimeHost({
  game: definition,
  initialState,
  update({ deltaMs, inputs, state, setState }) {},
  renderer,
  input,
  storage,       // optional; без него save/restore -> STORAGE_UNAVAILABLE
  audio,         // optional; отсутствие звука не останавливает игру
  environment,
  saveKey,
});
```

Обязательны `game`, синхронный `update`, `renderer`, `input`, `environment`. `storage` и `audio` необязательны; `saveKey` обязателен при наличии storage и включает namespace идентификатора игры. Runtime не ищет глобальные singleton и не загружает platform SDK сам. Автосохранение и автоматическое восстановление исключены из MVP: пользователь вызывает `save()`/`restore()` явно.

`update` — единственный путь игровой логики к изменению состояния. Runtime создаёт настоящий `createGameSession({ definition: game, initialState, onUpdate })`, где `onUpdate` синхронно вызывает `update` с накопленными с прошлого тика нормализованными `inputs`. `setState` — ограниченный временем текущего Core tick callback. Асинхронные `update`/`onUpdate`, прямые изменения renderer и replay предыдущих событий запрещены. Не изменять сигнатуру Core `onUpdate({deltaMs,state,setState})`: очередь ввода остаётся замыканием внутри Runtime.

### `RuntimeHost`

```js
await host.initialize();
host.start();
host.pause();
host.resume();
await host.save();
await host.restore();
host.stop();
await host.destroy();
host.getStatus();
host.getSnapshot();
host.subscribe(listener);
```

Статусы Runtime: `IDLE`, `READY`, `RUNNING`, `PAUSED`, `STOPPED`, `FAULTED`, `DESTROYED`. Core использует lowercase `idle/ready/running/paused/stopped`; Runtime явно отображает их, но не расширяет Core transitions. Ошибка синхронной операции бросает `RuntimeError` с устойчивым `code`, `cause` при наличии и без ложного успешного статуса; асинхронная операция отклоняет Promise с тем же типом. Никаких смешанных `throw`/`{error}` для одного метода. Повторные `pause` из `PAUSED`, `resume` из `RUNNING`, `stop` из `STOPPED` и `destroy` из `DESTROYED` — безопасные no-op. Остальные недопустимые переходы дают `INVALID_RUNTIME_TRANSITION`.

Правила lifecycle:

1. `initialize()` допустим только из `IDLE`: валидирует зависимости, создаёт Core session, монтирует renderer и вызывает Core `initialize`. В течение асинхронного mount другие transition/save/restore вызовы отклоняются `RUNTIME_OPERATION_IN_PROGRESS`; при отказе mount выполняется bounded cleanup, статус остаётся `IDLE`, ошибка — `INITIALIZE_FAILED`. Не читает storage.
2. `restore()` допустим только из `READY` до первого `start()`, когда Core позволяет `restore` из `ready`; после успешного Core restore renderer получает новый независимый snapshot до первого gameplay frame. `start()` допустим только из `READY` и вызывает Core `start`; переход из `PAUSED` выполняет исключительно `resume()`/Core `resume`.
3. `pause()` из `RUNNING` сначала отменяет pending frame, очищает input queue, вызывает Core `pause`, приостанавливает audio и запрещает gameplay input. `resume()` возвращает тот же Core session и сбрасывает временную базу scheduler; никаких старых input events.
4. `stop()` из `READY`/`RUNNING`/`PAUSED` вызывает Core `stop`, отменяет frame и очищает очередь. `STOPPED` — терминальное состояние этой сессии: для повторного запуска/restore нужен новый host, а не `initialize()` в существующем.
5. `destroy()` разрешён из любого состояния, отменяет кадры, останавливает Core session, если он ещё не `stopped`, отписывает listener/viewport, отключает ввод и вызывает renderer `unmount`. Вызывающий владеет инъецированными input/storage/audio/environment и уничтожает их сам; host не вызывает их `destroy`, чтобы не уничтожить разделяемый ресурс. `destroy()` идемпотентен.
6. Исключение из игрового `update`, `renderer.render`, scheduler/viewport callback или непреодолимая ошибка frame приводит к `FAULTED`: frame отменён, input отключён, Core session переводится в `stopped` (если переход доступен), причина доступна через `RuntimeError`, дальнейшие gameplay transitions запрещены. Из `FAULTED` разрешён только `destroy`; `save()` допускается отдельно, если Core snapshot валиден и storage доступен.

`save()` допустим из `READY/RUNNING/PAUSED/STOPPED` (и `FAULTED` при валидном snapshot), но не из `IDLE/DESTROYED` или во время `initialize/restore`. Параллельные сохранения сериализуются по порядку вызовов. `restore` и `destroy` при незавершённом save/restore отклоняются `RUNTIME_OPERATION_IN_PROGRESS` без изменения состояния; вызывающий дожидается операции и повторяет запрос. `subscribe(listener)` сообщает события `{schemaVersion:1,type:'status'|'error',status,errorCode?:string}` и возвращает unsubscribe; ошибки listener собираются в диагностике, не создавая ложного успешного статуса и не останавливая обработку других listener.

**Тик:** variable timestep от единственного `environment.now()` (монотонные миллисекунды). В первом callback после `start`/`resume` передаётся `deltaMs=0`, далее `deltaMs=clamp(now-last,0,100)`. Максимум один pending `requestFrame`, без catch-up цикла. `pause/stop/destroy/FAULTED` отменяют ожидающий frame; callback после отмены не вызывает Core `tick`. В тестах используется детерминированный fake environment. `clock` как отдельная зависимость исключён.

### `RuntimeRenderer`

```ts
{
  mount({ root, viewport, snapshot, dispatchInput }): void | Promise<void>,
  resize(viewport): void,
  render(snapshot): void,
  unmount(): void | Promise<void>,
}
```

Renderer получает snapshot и normalized viewport, но не владеет Core state. `render` не должен менять состояние игры. DOM/canvas/Phaser принадлежат конкретному adapter.

`dispatchInput` и `RuntimeInput.subscribe` направляют события в один нормализующий/валидирующий путь Runtime. `render` получает независимую копию Core snapshot. Исключение из `render` переводит host в `FAULTED`; ошибку `unmount` возвращает `destroy()` после остановки scheduler и попытки остального cleanup.

### `RuntimeInput`

```ts
{
  subscribe(listener): () => void,
  enable(): void,
  disable(): void,
  destroy(): void,
}
```

Событие v1: `{schemaVersion:1,type:'keyboard'|'pointer'|'touch',action:string,phase:'down'|'move'|'up'|'cancel',timestamp:number,source:'input'|'renderer',key?:string,pointer?:{id:number,x:number,y:number,button?:number}}`. `timestamp` — конечное монотонное время в миллисекундах из Runtime clock domain; координаты — конечные числа в CSS pixels относительно root. Неизвестные поля, accessor, NaN и неподдерживаемые значения блокируются. Runtime принимает только валидированные, скопированные события; в `READY/PAUSED/STOPPED/FAULTED` они не попадают в игровой тик. События за предыдущую сессию/до `resume` не переигрываются. Очередь ограничена 256 событиями; при переполнении отклоняется новое событие с наблюдаемым `INPUT_QUEUE_OVERFLOW`, без потери уже принятых событий и без безграничного накопления.

### `RuntimeStorage`

```ts
{
  load(key): Promise<null | PersistedRecord>,
  save(key, record): Promise<void>,
  clear(key): Promise<void>,
}
```

`PersistedRecord` — внешний конверт `{formatVersion:1,savedAt, snapshot, snapshotSha256}`. Вложенный `snapshot` передаётся в Core `restore` без добавочных полей и содержит ровно `{schemaVersion:1,gameId,gameVersion,revision,state}`. `savedAt` — ISO-8601 UTC для диагностики, не источник порядка или авторитетности. SHA-256 рассчитывается по UTF-8 каноническому JSON вложенного snapshot (детерминированный рекурсивный порядок полей, отдельный versioned encoder, без DOM/Node-only API в общих контрактах), lowercase hex; это защита от случайного повреждения, не криптографическая аутентификация владельца. При наличии storage Runtime использует `environment.digestSha256(bytes): Promise<string>` и `environment.utcNow(): string` для портативной и детерминированно тестируемой записи; browser adapter использует Web Crypto и UTC clock. Без storage эти две функции не обязательны. Отсутствующий crypto provider при попытке сохранить/восстановить даёт `DIGEST_UNAVAILABLE`, не фиктивный digest. На чтении сначала проверяются record schema, хеш, версия и identity; только потом Core `restore`.

Нет storage → `STORAGE_UNAVAILABLE`. Невалидный/изменённый record → `RESTORE_CORRUPT`; несовместимые schema/game/version → `RESTORE_INCOMPATIBLE`; ошибка чтения → `RESTORE_FAILED`; ошибка записи/нет подтверждения завершения → `SAVE_FAILED`. Нельзя сообщать `saved` при незавершённой записи. Сохранение не гарантирует атомарность внешнего хранилища: browser storage adapter обязан сообщать реальные ошибки/quota, не имитировать транзакцию.

### `RuntimeAudio`

```ts
{
  setMuted(value): void,
  setMasterVolume(value): void,
  play(asset, options): AudioHandle | Promise<AudioHandle>,
  stop(handle): void,
  pauseAll(): void,
  resumeAll(): void,
  destroy(): void,
}
```

`AudioHandle` — непрозрачный идентификатор конкретного воспроизведения, пригодный для `stop(handle)`. `asset` — game-owned asset ID, а не URL из platform SDK; `options` ограничены `loop` и `volume` [0,1]. Browser autoplay restrictions или отсутствующий адаптер возвращают `AUDIO_UNAVAILABLE`, но gameplay не падает. Runtime паузит audio при `pause()` и возобновляет при `resume()` только если был активен до паузы.

### `RuntimeEnvironment` и viewport

```ts
{
  root,
  now(): number,
  utcNow?(): string, // required when storage is enabled
  digestSha256?(bytes): Promise<string>, // required when storage is enabled
  requestFrame(callback): handle,
  cancelFrame(handle): void,
  observeViewport(listener): () => void,
  getViewport(): {
    width, height, dpr, orientation
  },
}
```

Размеры — конечные положительные CSS pixels, DPR — конечное положительное число; `orientation` вычисляется из размеров как `landscape` при width > height, иначе `portrait` (квадратный viewport считается portrait). Размеры и orientation передаются renderer через `resize`. `deviceClass` исключён из обязательного API: ширина viewport не доказывает тип устройства. Runtime не выбирает Yandex/VK по user-agent; platform-specific capability приходит позднее через Connect injection.

### Phaser adapter

Предлагаемый отдельный пакет `@ludory/runtime-phaser` экспортирует `createPhaserRenderer({ Phaser, sceneFactory, ... })`, реализующий `RuntimeRenderer`. Он не расширяет Core и не содержит Yandex/VK SDK. Adapter contract tests должны работать с минимальным fake Phaser surface, а реальный Phaser smoke — отдельный browser test.

## 4. Save/restore и ошибки

- Save/restore работает на уровне Core snapshot, не на уровне отдельных renderer objects.
- Restore разрешён только в `READY`, до первого `start`. После `stop` новый host/session, потому что Core `stopped` терминален.
- Snapshot schema version проверяется до применения; неизвестная версия даёт `RESTORE_INCOMPATIBLE`.
- Pause не означает save. `autosave`/`restoreOnInitialize` не реализуются в MVP и могут быть отдельным opt-in расширением после подтверждения ручного round trip.
- Runtime не создаёт фальшивые receipts и не преобразует отсутствие storage в PASS.

## 5. Будущий Connect contract

Connect должен подключаться снаружи через инъецируемые capability providers, например `platformStorage`, `platformAudioPolicy`, `platformLifecycle` и `platformShare`. Runtime знает только устойчивые интерфейсы, а не идентификаторы и SDK Яндекс/VK. Каждый adapter обязан иметь собственные package exports, tests, build entrypoint и live evidence gate.

## 6. Acceptance criteria

Runtime MVP можно считать реализованным только когда все пункты подтверждены:

- новая Studio-игра стартует в браузере через engine-neutral host;
- Core session lifecycle и Runtime status transitions покрыты unit/integration tests;
- input работает с keyboard, pointer и touch normalized events;
- pause/resume не теряет и не дублирует gameplay input;
- save/restore round trip проходит с fake storage и browser storage adapter, включая stale/incompatible/error cases;
- viewport resize и mobile orientation проходят в desktop и mobile browser viewports;
- audio mute/volume/pause/resume не ломают gameplay при autoplay denial;
- Phaser adapter тестируется отдельно и не импортируется Core;
- нет зависимостей Runtime от Yandex/VK SDK;
- есть независимый browser smoke; его PASS не считается Connect или Release PASS.

## 7. Test strategy

1. Unit: pure lifecycle state machine, input normalization, snapshot validation, errors and idempotence.
2. Contract integration: fake Core definition/session, deterministic clock/scheduler, fake renderer/storage/input/audio.
3. Browser: Playwright/real browser for canvas/DOM mount, resize, keyboard/pointer/touch, storage round trip and reload.
4. Mobile: bounded device emulation plus at least one real-device check before platform claims; device evidence remains separate.
5. Phaser: adapter contract tests with fake surface and one real Phaser browser smoke.
6. Negative gates: no silent save success, no input replay after pause, no Core browser import, no SDK import in Runtime, no renderer mutation of state.

Поддерживаемая MVP browser matrix: Playwright Chromium/Firefox/WebKit desktop; mobile viewport/interaction emulation в Chromium Android и WebKit iPhone. Это не подменяет хотя бы один реальный mobile device smoke перед platform/Release claims. Зафиксировать версии Playwright/browser runtime в lockfile и evidence. Новый Studio template должен получать локальный проверяемый browser ESM bundle, а не bare `@ludory/runtime` import в несобранном HTML и не обязательный CDN; сборка и хеширование артефакта выполняются явно в R6, без сетевого bootstrap при `Studio create`.

## 8. Approval gates and open decisions

В этой редакции выбраны: отдельный `@ludory/runtime-phaser`, variable timestep `0..100ms`, manual restore только в `READY`, отсутствие autosave в MVP, audio handle, указанная browser matrix и локальная сборка для Studio. Дальнейшие изменения этих решений требуют отдельного review. R1 начинается только на выделенной ветке после сверки реализации Core API с этой редакцией; ни Connect, ни Release не входят в область Runtime MVP.
