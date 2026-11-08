import { buildNarrativeJournal, resolveNarrativeView } from '@ludory/narrative';
import { narrativeAction } from './update.mjs';
import { resolveNarrativePresentation } from './presentation.mjs';
import { NARRATIVE_CSS } from './styles.mjs';

const UI = {
  ru: { next: 'Далее', back: 'Назад', journal: 'Журнал', hide: 'Скрыть журнал', empty: 'Пока нет воспоминаний',
    story: 'История',
    memories: 'Воспоминания', photos: 'Фотоальбом', keepsakes: 'Памятные предметы', messages: 'Сообщения',
    intent: 'Смысл сообщения', tone: 'Тон', attachment: 'Вложение', none: 'Без вложения',
    recipient: 'Кому', preview: 'Предпросмотр', send: 'Отправить', cancel: 'Отмена', compose: 'Составить сообщение',
    facts: 'Отношения', reply: 'Ответ', ending: 'Конец истории',
    unavailable: 'Изображение недоступно', choice: 'Выбор', photo: 'Фото', keepsake: 'Предмет',
    premiumUnlocked: 'Открыто', premiumConfirm: 'Подтвердить открытие', premiumCancel: 'Отмена',
    premiumPending: 'Сохраняем открытие…', premiumError: 'Не удалось сохранить открытие. Восстановите сохранение и попробуйте снова.',
    premiumInsufficient: 'Недостаточно игровой валюты для этого выбора.',
    premiumUnavailable: 'Недоступно до восстановления сохранения', premiumRetry: 'Восстановить сохранение',
    premiumRecovering: 'Проверяем сохранение…' },
  en: { next: 'Continue', back: 'Back', journal: 'Journal', hide: 'Hide journal', empty: 'Nothing collected yet',
    story: 'Narrative',
    memories: 'Memories', photos: 'Photo album', keepsakes: 'Keepsakes', messages: 'Messages',
    intent: 'Message intent', tone: 'Tone', attachment: 'Attachment', none: 'No attachment',
    recipient: 'To', preview: 'Preview', send: 'Send', cancel: 'Cancel', compose: 'Compose message',
    facts: 'Relationships', reply: 'Reply', ending: 'The end',
    unavailable: 'Image unavailable', choice: 'Choice', photo: 'Photo', keepsake: 'Keepsake',
    premiumUnlocked: 'Unlocked', premiumConfirm: 'Confirm unlock', premiumCancel: 'Cancel',
    premiumPending: 'Saving unlock…', premiumError: 'Could not save unlock. Please retry.',
    premiumInsufficient: 'Not enough currency for this choice.',
    premiumUnavailable: 'Unavailable until save recovery', premiumRetry: 'Restore saved wallet',
    premiumRecovering: 'Checking saved wallet…' },
};

function localAsset(src) {
  if (typeof src !== 'string' || /[\\\u0000-\u001f\u007f]/.test(src)) return false;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(src)) return true;
  if (!(src.startsWith('./') || src.startsWith('assets/') ||
      (src.startsWith('/') && !src.startsWith('//')))) return false;
  // Browser URL parsing treats backslashes like separators; never trust only startsWith('/') checks.
  try { return new URL(src, 'https://ludory.local/story/').origin === 'https://ludory.local'; }
  catch { return false; }
}

/** Browser-only, DOM-based opt-in RuntimeRenderer. No SDK, server or camera. */
export function createNarrativeRenderer({ graph, catalog, locale = 'ru', assets = {},
  labels = {}, relationFacts = [], preferredMobileOrientation = 'auto',
  now = () => globalThis.performance.now(), canBack = () => false, premiumChoices, presentation } = {}) {
  if (!graph || !catalog) throw new TypeError('graph and catalog required');
  if (!UI[locale]) throw new TypeError('unsupported locale');
  if (!['auto', 'portrait'].includes(preferredMobileOrientation)) throw new TypeError('unsupported mobile orientation preference');
  if (typeof now !== 'function') throw new TypeError('now must be a clock function');
  if (typeof canBack !== 'function') throw new TypeError('canBack must be a function');
  if (premiumChoices !== undefined && (!premiumChoices ||
      ['getChoiceAccess','getRevision','getView','unlockChoice','initialize'].some(key => typeof premiumChoices[key] !== 'function'))) {
    throw new TypeError('premiumChoices must provide a read-only access and unlock port');
  }
  if (premiumChoices?.assertGraphCompatibility) premiumChoices.assertGraphCompatibility(graph);
  // Validate before inserting any authored image path in the DOM.
  if (presentation !== undefined) resolveNarrativePresentation(graph, presentation, {
    sceneId: graph.startSceneId, beatIndex: 0, flags: {}, memories: [], album: [], routeIntent: null,
    routeLock: null, relations: {},
  });
  let root = null;
  let style = null;
  let surface = null;
  let dispatchInput = null;
  let currentSnapshot = null;
  let lastRenderKey = null;
  let journalOpen = false;
  let selectedVariantId = null;
  let selectedBeatId = null;
  let composerOpen = true;
  let mountGeneration = 0;
  let focusHint = null;
  let confirmUnlock = null;
  let pendingUnlock = null;
  let pendingRecovery = false;
  let unlockError = null;
  let paintedStage = null;
  let stageKey = null;

  function humanLabel(group, value) {
    const authored = labels?.[group]?.[value];
    const candidate = typeof authored === 'string' ? authored : authored?.[locale];
    return typeof candidate === 'string' && candidate.trim() ? candidate : value;
  }

  function element(tag, content, className) {
    const node = root.ownerDocument.createElement(tag);
    if (content !== undefined) node.textContent = String(content);
    if (className) node.className = className;
    return node;
  }

  function command(action, event) {
    if (!surface || !dispatchInput) return;
    const timestamp = now();
    if (!Number.isFinite(timestamp) || timestamp < 0) return;
    dispatchInput({ schemaVersion: 1, type: event?.detail === 0 ? 'keyboard' : 'pointer',
      action, phase: 'up', timestamp, source: 'renderer' });
  }

  function button(label, action, group, extras = {}) {
    const b = element('button', label);
    b.setAttribute('type', 'button');
    const ownGeneration = mountGeneration;
    if (action) {
      b.dataset.action = action;
      b.addEventListener('click', event => {
        if (ownGeneration === mountGeneration) command(action, event);
      });
    } else if (extras.onClick) b.addEventListener('click', event => {
      if (ownGeneration === mountGeneration && surface) extras.onClick(event);
    });
    if (extras.ui) b.dataset.ui = extras.ui;
    if (extras.disabled) b.setAttribute('disabled', '');
    if (extras.intent) b.dataset.intent = extras.intent;
    if (extras.tone) b.dataset.tone = extras.tone;
    if (Object.hasOwn(extras, 'attachment')) b.dataset.attachment = extras.attachment ?? '';
    if (extras.pressed !== undefined) b.setAttribute('aria-pressed', String(extras.pressed));
    if (extras.expanded !== undefined) b.setAttribute('aria-expanded', String(extras.expanded));
    group.appendChild(b);
    return b;
  }

  function actions(panel, items, type, beatId) {
    const wrap = element('div', undefined, 'ludory-narrative__actions');
    let needsRecovery = false;
    for (const item of items) {
      const action = narrativeAction(type, beatId, item.id);
      const access = premiumChoices && type === 'choose' ? premiumChoices.getChoiceAccess(beatId, item.id) : null;
      let b;
      if (access?.premium) {
        const icon = premiumChoices.getView().currency.icon;
        const key = `${beatId}:${item.id}`;
        if (access.status === 'unavailable') needsRecovery = true;
        if (access.status === 'unlocked') {
          b = button(`${item.label} · ${icon} ${UI[locale].premiumUnlocked}`, action, wrap);
        } else {
          const available = access.status === 'locked' && pendingUnlock === null && !pendingRecovery;
          b = button(`${item.label} · ${icon} ${access.cost}`, null, wrap, {
            ui: available ? 'premium-unlock' : 'premium-locked', disabled: !available,
            onClick: available ? () => {
              if (selectedBeatId !== beatId) return;
              confirmUnlock = key; unlockError = null;
              focusHint = { field: 'ui', value: 'premium-confirm' };
              draw(true);
            } : undefined,
          });
        }
      } else b = button(item.label, action, wrap);
      if (item.assetId) addAsset(wrap, item.assetId, b);
    }
    panel.appendChild(wrap);
    if (type !== 'choose' || !premiumChoices) return;
    if (needsRecovery && !pendingUnlock) {
      const recovery = element('div', undefined, 'ludory-narrative__premium-recovery');
      recovery.appendChild(element('p', pendingRecovery ? UI[locale].premiumRecovering : UI[locale].premiumUnavailable));
      button(UI[locale].premiumRetry, null, recovery, {
        ui: 'premium-retry', disabled: pendingRecovery,
        onClick: async () => {
          if (pendingRecovery || pendingUnlock || !surface || selectedBeatId !== beatId) return;
          const generation = mountGeneration;
          pendingRecovery = true;
          unlockError = null;
          draw(true);
          try { await premiumChoices.initialize(); }
          catch {
            if (mountGeneration === generation && surface) unlockError = 'save';
          }
          finally {
            if (mountGeneration === generation && surface) {
              pendingRecovery = false;
              draw(true);
            }
          }
        },
      });
      panel.appendChild(recovery);
    }
    if (pendingUnlock) {
      const p = element('p', UI[locale].premiumPending, 'ludory-narrative__premium-status');
      p.dataset.ui = 'premium-pending';
      p.setAttribute('aria-live', 'polite');
      panel.appendChild(p);
    }
    if (unlockError) {
      const insufficient = unlockError === 'insufficient';
      const p = element('p', insufficient ? UI[locale].premiumInsufficient : UI[locale].premiumError,
        'ludory-narrative__premium-error');
      p.dataset.ui = insufficient ? 'premium-insufficient' : 'premium-error';
      p.setAttribute('role', 'alert');
      panel.appendChild(p);
    }
    if (!confirmUnlock || pendingUnlock || pendingRecovery) return;
    const [selectedBeat, selectedChoice] = confirmUnlock.split(':');
    if (selectedBeat !== beatId || !items.some(item => item.id === selectedChoice)) return;
    const access = premiumChoices.getChoiceAccess(selectedBeat, selectedChoice);
    if (access.status !== 'locked') return;
    const confirm = element('div', undefined, 'ludory-narrative__premium-confirm');
    const currency = premiumChoices.getView().currency.icon;
    confirm.appendChild(element('p', `${UI[locale].premiumConfirm}: ${access.cost} ${currency}?`));
    const buttons = element('div', undefined, 'ludory-narrative__actions');
    button(UI[locale].premiumConfirm, null, buttons, { ui: 'premium-confirm', onClick: async () => {
      if (pendingUnlock || !surface || !premiumChoices || selectedBeatId !== selectedBeat ||
          confirmUnlock !== `${selectedBeat}:${selectedChoice}`) return;
      const generation = mountGeneration;
      pendingUnlock = confirmUnlock;
      confirmUnlock = null;
      unlockError = null;
      draw(true);
      try { await premiumChoices.unlockChoice(selectedBeat, selectedChoice); }
      catch (error) {
        if (mountGeneration === generation && surface) {
          unlockError = error?.code === 'INSUFFICIENT_FUNDS' ? 'insufficient' : 'save';
        }
      }
      finally {
        if (mountGeneration === generation && surface) { pendingUnlock = null; draw(true); }
      }
    } });
    button(UI[locale].premiumCancel, null, buttons, { ui: 'premium-cancel', onClick: () => {
      confirmUnlock = null; draw(true);
    } });
    confirm.appendChild(buttons);
    panel.appendChild(confirm);
  }

  function addAsset(container, assetId, buttonNode) {
    const src = Object.hasOwn(assets, assetId) ? assets[assetId] : null;
    const fallback = element('span', `${UI[locale].unavailable}: ${assetId}`, 'ludory-narrative__fallback');
    if (!localAsset(src)) { container.appendChild(fallback); return; }
    const image = element('img');
    image.setAttribute('src', src);
    image.setAttribute('alt', buttonNode.textContent);
    image.addEventListener('error', () => { image.remove(); container.appendChild(fallback); });
    container.appendChild(image);
  }

  function visualStage(view, narrativeState) {
    if (presentation === undefined) return null;
    // resolveNarrativeView may advance past an unavailable echo on a validated copy.
    const scene = graph.scenes.find(item => item.id === view.sceneId);
    const beatIndex = scene.beats.findIndex(item => item.id === view.beatId);
    const displayState = { ...narrativeState, sceneId: view.sceneId, beatIndex };
    const cue = resolveNarrativePresentation(graph, presentation, displayState);
    const key = `${locale}:${view.beatId}:${cue?.id ?? ''}`;
    if (paintedStage && stageKey === key) return { stage: paintedStage, cue };
    const stage = element('div', undefined, 'ludory-narrative__stage');
    paintedStage = stage;
    stageKey = key;
    stage.dataset.variantId = cue?.id ?? '';
    stage.dataset.cgMode = cue?.cg?.mode ?? '';
    if (!cue || cue.neutral) {
      stage.dataset.neutral = cue?.neutral?.reason ?? 'unmapped';
      return { stage, cue };
    }
    function addLayer(role, mediaId, extra = {}) {
      const media = presentation.media[mediaId];
      // document.baseURI may be redirected by an authored <base> element.
      // Resolve against the actual document URL and reject non-HTTP origins.
      let source;
      try {
        const documentUrl = new URL(root.ownerDocument.URL);
        source = new URL(media.src, documentUrl);
        if (!['http:', 'https:'].includes(source.protocol) || source.origin !== documentUrl.origin) {
          throw new TypeError('presentation image origin mismatch');
        }
      } catch {
        stage.dataset.degraded = 'true';
        return;
      }
      const image = element('img', undefined, `ludory-narrative__${role}`);
      image.dataset.role = role;
      if (extra.slot) image.dataset.slot = extra.slot;
      if (extra.characterId) image.dataset.characterId = extra.characterId;
      image.setAttribute('src', source.href);
      image.setAttribute('alt', media.alt?.[locale] ?? '');
      image.setAttribute('decoding', 'async');
      image.setAttribute('draggable', 'false');
      image.addEventListener('error', () => {
        // Only discard this broken layer. Do not restore the art from a previous beat.
        image.remove();
        stage.dataset.degraded = 'true';
      });
      stage.appendChild(image);
    }
    if (cue.cg?.mode !== 'replace-stage') {
      if (cue.background) addLayer('background', cue.background);
      for (const portrait of cue.portraits ?? []) addLayer('portrait', portrait.mediaId, portrait);
    }
    if (cue.cg) addLayer('cg', cue.cg.mediaId);
    return { stage, cue };
  }

  function unique(items) { return [...new Set(items)]; }

  function composer(panel, view) {
    const variants = view.variants;
    if (!variants.length) {
      panel.appendChild(element('p', UI[locale].unavailable));
      return;
    }
    if (!composerOpen) {
      const row = element('div', undefined, 'ludory-narrative__actions');
      button(UI[locale].compose, null, row, { ui: 'compose-message', onClick: () => {
        composerOpen = true;
        selectedVariantId = null;
        focusHint = { field: 'intent', value: variants[0].intent };
        draw(true);
      } });
      panel.appendChild(row);
      return;
    }
    let selected = variants.find(v => v.id === selectedVariantId) ?? variants[0];
    selectedVariantId = selected.id;
    const section = element('div', undefined, 'ludory-narrative__variants');
    function group(label, options, active, onChoose, field) {
      const wrapper = element('div', undefined, 'ludory-narrative__group');
      wrapper.appendChild(element('h3', label));
      const row = element('div', undefined, 'ludory-narrative__actions');
      for (const opt of options) {
        button(opt === null ? UI[locale].none : humanLabel(field === 'attachment' ? 'journal' : field, opt), null, row, {
          [field]: opt, pressed: opt === active,
          onClick: () => {
            selectedVariantId = onChoose(opt).id;
            focusHint = { field, value: opt ?? '' };
            draw(true);
          },
        });
      }
      wrapper.appendChild(row);
      section.appendChild(wrapper);
    }
    group(UI[locale].intent, unique(variants.map(v => v.intent)), selected.intent,
      intent => variants.find(v => v.intent === intent), 'intent');
    const byIntent = variants.filter(v => v.intent === selected.intent);
    group(UI[locale].tone, unique(byIntent.map(v => v.tone)), selected.tone,
      tone => byIntent.find(v => v.tone === tone), 'tone');
    const byTone = byIntent.filter(v => v.tone === selected.tone);
    if (unique(byTone.map(v => v.attachmentId)).length > 1) {
      group(UI[locale].attachment, unique(byTone.map(v => v.attachmentId)), selected.attachmentId,
        attachment => byTone.find(v => v.attachmentId === attachment));
    }
    section.appendChild(element('p', `${UI[locale].recipient}: ${humanLabel('recipient', selected.recipient)}`));
    section.appendChild(element('h3', UI[locale].preview));
    const preview = element('p', selected.preview, 'ludory-narrative__preview');
    preview.setAttribute('aria-live', 'polite');
    section.appendChild(preview);
    const send = element('div', undefined, 'ludory-narrative__actions');
    button(UI[locale].send, narrativeAction('interact', view.beatId, selected.id), send);
    button(UI[locale].cancel, null, send, { ui: 'cancel-message', onClick: () => {
      composerOpen = false;
      selectedVariantId = null;
      focusHint = { field: 'ui', value: 'compose-message' };
      draw(true);
    } });
    section.appendChild(send);
    panel.appendChild(section);
  }

  function journal(panel) {
    const content = buildNarrativeJournal(graph, catalog, currentSnapshot.state.narrative, locale);
    const wrapper = element('aside', undefined, 'ludory-narrative__journal');
    wrapper.setAttribute('aria-label', UI[locale].journal);
    wrapper.appendChild(element('h2', UI[locale].journal));
    let any = false;
    for (const [name, label] of [['memories','memories'],['album','photos'],['keepsakes','keepsakes'],['messages','messages']]) {
      if (!content[name].length) continue;
      any = true;
      wrapper.appendChild(element('h3', UI[locale][label]));
      const list = element('ul');
      for (const item of content[name]) {
        const value = typeof item === 'string' ? humanLabel('journal', item) :
          `${humanLabel('recipient', item.recipient)}: ${item.reply}`;
        const entry = element('li', value);
        if (name === 'album' && typeof item === 'string') addAsset(entry, item, element('span', value));
        list.appendChild(entry);
      }
      wrapper.appendChild(list);
    }
    const facts = relationFacts.filter(fact => typeof fact?.id === 'string' &&
      Number.isSafeInteger(fact.min) && fact.min > 0 &&
      (currentSnapshot.state.narrative.relations[fact.id] ?? 0) >= fact.min &&
      typeof fact.text?.[locale] === 'string' && fact.text[locale].trim());
    if (facts.length) {
      any = true;
      wrapper.appendChild(element('h3', UI[locale].facts));
      const list = element('ul');
      for (const fact of facts) list.appendChild(element('li', fact.text[locale]));
      wrapper.appendChild(list);
    }
    if (!any) wrapper.appendChild(element('p', UI[locale].empty));
    panel.appendChild(wrapper);
  }

  function draw(force = false) {
    if (!surface || !currentSnapshot) return;
    const state = currentSnapshot.state.narrative;
    const key = `${locale}:${JSON.stringify(state)}:${journalOpen}:${selectedVariantId}:${composerOpen}:` +
      `${premiumChoices?.getRevision() ?? ''}:${confirmUnlock}:${pendingUnlock}:${pendingRecovery}:${unlockError}`;
    if (!force && lastRenderKey === key) return; // preserve focus and click targets across high-FPS frames
    const view = resolveNarrativeView(graph, catalog, state, locale);
    const visual = visualStage(view, state);
    const beatChanged = selectedBeatId !== view.beatId;
    if (beatChanged) {
      selectedBeatId = view.beatId;
      selectedVariantId = null;
      composerOpen = true;
      confirmUnlock = null;
      unlockError = null;
    }
    const panel = element('article', undefined, 'ludory-narrative__panel');
    panel.dataset.sceneId = view.sceneId;
    panel.dataset.beatId = view.beatId;
    panel.setAttribute('aria-label', UI[locale].story);
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('tabindex', '-1');
    const toolbar = element('nav', undefined, 'ludory-narrative__toolbar');
    toolbar.setAttribute('aria-label', UI[locale].journal);
    if (canBack()) button(UI[locale].back, 'narrative:back', toolbar);
    button(journalOpen ? UI[locale].hide : UI[locale].journal, null, toolbar, {
      ui: 'journal', expanded: journalOpen, onClick: () => {
        journalOpen = !journalOpen;
        focusHint = { field: 'ui', value: 'journal' };
        draw(true);
      },
    });
    panel.appendChild(toolbar);
    if (journalOpen) journal(panel);
    else {
      if (visual?.cue?.speaker) {
        const speaker = element('p', visual.cue.speaker[locale], 'ludory-narrative__speaker');
        speaker.dataset.ui = 'speaker';
        panel.appendChild(speaker);
      }
      const headingText = view.label || (view.type === 'ending' ? UI[locale].ending : null);
      if (headingText) {
        const heading = element('h2', headingText);
        heading.setAttribute('tabindex', '-1');
        panel.appendChild(heading);
      }
      if (view.text) panel.appendChild(element('p', view.text));
      if (view.type === 'choice') actions(panel, view.choices, 'choose', view.beatId);
      if (['photo','keepsake'].includes(view.type)) actions(panel, view.options, 'interact', view.beatId);
      if (view.type === 'message') composer(panel, view);
      if (['dialogue','echo'].includes(view.type)) {
        const row = element('div', undefined, 'ludory-narrative__actions');
        button(UI[locale].next, narrativeAction('next', view.beatId), row);
        panel.appendChild(row);
      }
      if (state.messages.length && ['echo', 'choice', 'ending'].includes(view.type)) {
        const reply = state.messages.at(-1).reply[locale];
        const label = element('p', `${UI[locale].reply}: ${reply}`, 'ludory-narrative__reply');
        label.setAttribute('aria-live', 'polite');
        panel.appendChild(label);
      }
    }
    const priorFocus = root.ownerDocument.activeElement;
    const focusWasInside = surface.contains?.(priorFocus) ?? false;
    if (visual) surface.replaceChildren(visual.stage, panel);
    else surface.replaceChildren(panel);
    if (focusWasInside) {
      let candidate;
      if (focusHint && typeof surface.querySelectorAll === 'function') {
        candidate = [...surface.querySelectorAll('button')].find(node =>
          node.dataset[focusHint.field] === focusHint.value);
      }
      if (!candidate && beatChanged) candidate = panel.querySelector?.('h2');
      (candidate ?? panel).focus?.({ preventScroll: true });
    }
    focusHint = null;
    lastRenderKey = `${locale}:${JSON.stringify(state)}:${journalOpen}:${selectedVariantId}:${composerOpen}:` +
      `${premiumChoices?.getRevision() ?? ''}:${confirmUnlock}:${pendingUnlock}:${pendingRecovery}:${unlockError}`;
  }

  return Object.freeze({
    async mount({ root: nextRoot, viewport, snapshot, dispatchInput: nextDispatch }) {
      if (surface) throw new TypeError('renderer already mounted');
      if (!nextRoot?.ownerDocument?.createElement || typeof nextRoot.appendChild !== 'function' ||
          typeof nextDispatch !== 'function') throw new TypeError('DOM root and dispatchInput required');
      root = nextRoot;
      mountGeneration++;
      dispatchInput = nextDispatch;
      style = element('style', NARRATIVE_CSS);
      surface = element('section', undefined, 'ludory-narrative');
      if (presentation !== undefined) surface.dataset.visual = 'true';
      surface.dataset.mobilePreference = preferredMobileOrientation;
      surface.setAttribute('role', 'region');
      surface.setAttribute('aria-label', UI[locale].story);
      root.appendChild(style);
      root.appendChild(surface);
      this.resize(viewport);
      this.render(snapshot);
    },
    resize(viewport) {
      if (!surface || !viewport) return;
      surface.dataset.orientation = viewport.orientation === 'portrait' ? 'portrait' : 'landscape';
    },
    render(snapshot) { if (!surface) return; currentSnapshot = snapshot; draw(); },
    setLocale(next) {
      if (!UI[next]) throw new TypeError('unsupported locale');
      locale = next;
      surface?.setAttribute('aria-label', UI[locale].story);
      selectedVariantId = null;
      composerOpen = true;
      draw(true);
    },
    async unmount() {
      // Invalidate callbacks from orphaned buttons before removing DOM.
      dispatchInput = null;
      mountGeneration++;
      surface?.remove();
      style?.remove();
      surface = null;
      style = null;
      root = null;
      currentSnapshot = null;
      lastRenderKey = null;
      selectedBeatId = null;
      selectedVariantId = null;
      journalOpen = false;
      confirmUnlock = null;
      pendingUnlock = null;
      pendingRecovery = false;
      unlockError = null;
      paintedStage = null;
      stageKey = null;
    },
  });
}
