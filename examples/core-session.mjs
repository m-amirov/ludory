import { defineGame, createGameSession } from '../packages/core/src/index.mjs';

const definition = defineGame({
  schemaVersion: 1,
  id: 'sky-routes',
  version: '0.1.0',
  title: { ru: 'Небесные маршруты', en: 'Sky Routes' },
  engine: 'phaser',
  targets: ['yandex-games', 'vk-games'],
});

const options = {
  definition,
  initialState: { score: 0 },
  onUpdate({ deltaMs, state, setState }) {
    setState({ score: state.score + Math.round(deltaMs) });
  },
};

const game = createGameSession(options);
game.initialize();
game.start();
game.tick(16.67);
game.pause();
const saved = game.snapshot();
game.stop();

const resumed = createGameSession(options);
resumed.initialize();
resumed.restore(saved);
resumed.start();

console.log(JSON.stringify({ targets: definition.targets, restored: resumed.snapshot() }, null, 2));
