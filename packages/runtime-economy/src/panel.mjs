const LABELS = Object.freeze({
  ru: {
    wallet: 'Кошелёк', unavailable: 'Кошелёк недоступен. Проверьте сохранение.',
    busy: 'Ожидаем подтверждения сохранения…', failed: 'Не удалось выполнить операцию. Повторите попытку.',
    saved: 'Операция подтверждена', reload: 'Повторить загрузку кошелька',
    starter: 'Получить стартовый бонус', daily: 'Получить ежедневную награду', rewarded: 'Посмотреть рекламу за награду',
    retryReward: 'Повторить сохранение награды (без просмотра рекламы)',
    catalog: 'Показать магазин', restore: 'Восстановить покупки', buy: 'Купить',
    empty: 'Товаров для покупки нет', dailyUsed: 'Ежедневная награда уже получена',
  },
  en: {
    wallet: 'Wallet', unavailable: 'Wallet is unavailable. Check saved progress.',
    busy: 'Waiting for storage confirmation…', failed: 'Operation failed. Please retry.',
    saved: 'Operation confirmed', reload: 'Retry wallet load',
    starter: 'Claim starter bonus', daily: 'Claim daily reward', rewarded: 'Watch an ad for a reward',
    retryReward: 'Retry reward save (without another ad)',
    catalog: 'Show store', restore: 'Restore purchases', buy: 'Buy',
    empty: 'No products available', dailyUsed: 'Daily reward already claimed',
  },
});

function safePrice(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 250 ||
      !Number.isSafeInteger(item.currencyAmount) || item.currencyAmount <= 0 ||
      typeof item.priceCurrencyCode !== 'string' || !/^[\p{L}\p{N} _-]{1,20}$/u.test(item.priceCurrencyCode)) {
    throw new TypeError('SDK catalog contains an invalid offering');
  }
  const price = item.priceValue;
  if (!((typeof price === 'number' && Number.isFinite(price) && price >= 0) ||
      (typeof price === 'string' && /^\d+(?:[.,]\d{1,2})?$/.test(price)))) {
    throw new TypeError('SDK catalog contains an invalid numeric price');
  }
  return `${price} ${item.priceCurrencyCode}`;
}

function portalImage(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Explicit, platform-neutral player controls; never initializes, grants, shows ads or lists store on render. */
export function createEconomyPanel({ root, wallet, locale = 'ru', target = 'vk-games', storeEnabled = false } = {}) {
  if (!root || typeof root.replaceChildren !== 'function' || typeof root.appendChild !== 'function' ||
      typeof root.ownerDocument?.createElement !== 'function') throw new TypeError('DOM root required');
  if (!wallet || ['getView','getRewardsView','initialize','grantStarter','claimDaily','claimRewarded',
    'retryPendingReward','getStoreCatalog','purchaseProduct','restorePurchases']
    .some(name => typeof wallet[name] !== 'function')) throw new TypeError('Complete economy runtime port required');
  if (!Object.hasOwn(LABELS, locale)) throw new TypeError('unsupported locale');
  if (!['yandex-games', 'vk-games'].includes(target) || typeof storeEnabled !== 'boolean') {
    throw new TypeError('unsupported economy presentation target');
  }
  const text = LABELS[locale];
  const purchasesAvailable = target === 'yandex-games' && storeEnabled;
  let disposed = false;
  let busy = false;
  let generation = 0;
  let feedback = '';
  let offers = null;

  function element(name, content, ui) {
    const node = root.ownerDocument.createElement(name);
    if (content !== undefined) node.textContent = String(content);
    if (ui) node.dataset.ui = ui;
    return node;
  }
  async function act(operation) {
    if (disposed || busy) return;
    busy = true;
    feedback = '';
    render();
    try {
      await operation();
      if (!disposed) feedback = text.saved;
    } catch {
      // SDK and storage exception messages can contain raw purchase tokens.
      if (!disposed) feedback = text.failed;
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }
  function button(parent, label, ui, operation, disabled = false) {
    const control = element('button', label, ui);
    control.setAttribute('type', 'button');
    const issuedAt = generation;
    if (disabled || busy) control.setAttribute('disabled', '');
    control.addEventListener('click', () => {
      if (disposed || issuedAt !== generation || busy) return;
      return act(operation);
    });
    parent.appendChild(control);
    return control;
  }

  function render() {
    if (disposed) return;
    generation++;
    const view = wallet.getView();
    if (!view.enabled) { root.replaceChildren(); return; }
    const panel = element('section', undefined, 'economy-panel');
    panel.setAttribute('aria-label', text.wallet);
    panel.appendChild(element('h2', text.wallet));
    const status = element('p', busy ? text.busy : feedback, 'economy-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (!view.ready || view.balance === null) {
      panel.appendChild(element('p', text.unavailable));
      if (view.pendingReward) {
        button(panel, text.retryReward, 'economy-retry-reward', () => wallet.retryPendingReward());
      } else {
        button(panel, text.reload, 'economy-reload', () => wallet.initialize());
      }
    } else {
      panel.appendChild(element('p', `${view.currency.icon} ${view.balance} ${view.currency.displayName}`, 'economy-balance'));
      const rewards = wallet.getRewardsView();
      if (rewards.pendingReward) {
        button(panel, text.retryReward, 'economy-retry-reward', () => wallet.retryPendingReward());
      } else {
        if (rewards.amounts.starter > 0) button(panel,
          `${text.starter} (+${rewards.amounts.starter})`, 'economy-starter', () => wallet.grantStarter());
        if (rewards.amounts.daily > 0) button(panel,
          rewards.daily.eligible ? `${text.daily} (+${rewards.amounts.daily})` : text.dailyUsed,
          'economy-daily', () => wallet.claimDaily(), !rewards.daily.eligible);
        if (rewards.amounts.rewarded > 0) button(panel,
          `${text.rewarded} (+${rewards.amounts.rewarded})`, 'economy-rewarded', () => wallet.claimRewarded());
      }
      if (purchasesAvailable) {
        button(panel, text.catalog, 'economy-catalog', async () => {
          const catalog = await wallet.getStoreCatalog();
          if (!Array.isArray(catalog)) throw new TypeError('invalid SDK catalog');
          const ids = new Set();
          for (const item of catalog) {
            safePrice(item);
            if (ids.has(item.id)) throw new TypeError('duplicate SDK product');
            ids.add(item.id);
          }
          offers = catalog.map(item => ({ ...item }));
        });
        button(panel, text.restore, 'economy-restore', () => wallet.restorePurchases());
        if (offers !== null) {
          if (!offers.length) panel.appendChild(element('p', text.empty));
          for (const item of offers) {
            const offer = element('div', undefined, 'economy-offer');
            offer.appendChild(element('p', `${item.title} · +${item.currencyAmount} ${view.currency.displayName}`));
            const nativeIcon = portalImage(item.priceCurrencyImage);
            if (nativeIcon) {
              const image = element('img');
              image.setAttribute('src', nativeIcon);
              image.setAttribute('alt', item.priceCurrencyCode);
              image.setAttribute('loading', 'lazy');
              offer.appendChild(image);
            }
            button(offer, `${text.buy} · ${safePrice(item)}`, `economy-product-${item.id}`,
              () => wallet.purchaseProduct(item.id));
            panel.appendChild(offer);
          }
        }
      }
    }
    panel.appendChild(status);
    root.replaceChildren(panel);
  }

  return Object.freeze({ render, dispose() {
    if (disposed) return;
    disposed = true; generation++;
    root.replaceChildren();
  } });
}
