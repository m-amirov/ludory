// A green, executable shell-facing script with no game-owned win assertion.
// The fact it exits 0 is exactly the adversarial failure under test.
import { solverTransition, previewTransition } from '../src/bogus-solver.mjs';

if (solverTransition(0) === previewTransition(0)) {
  process.stdout.write('100% solvable\n');
}
