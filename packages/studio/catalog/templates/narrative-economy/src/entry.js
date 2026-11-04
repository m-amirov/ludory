import { startEconomyNarrative } from './main.js';

// Demonstration is intentionally off. Platform-specific cloud ports are
// attached only by the game author in an explicitly monetized game.
void startEconomyNarrative().catch(() => {
  document.querySelector('#status').textContent = 'Запуск недоступен. Проверьте настройку облачного кошелька.';
});
