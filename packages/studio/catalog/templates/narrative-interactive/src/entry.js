import { startNarrative } from './main.js';

void startNarrative().catch(error => {
  document.querySelector('#status').textContent = error.message;
  document.querySelector('#game').textContent = 'Не удалось запустить историю.';
});
