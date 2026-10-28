import { initialStory, transition, spokenLine, legalActions } from './story-rules.mjs';

// This is the module actually loaded by index.html in the new test game.
export function playRoute(actions) {
  let state = initialStory();
  for (const action of actions) state = transition(state, action);
  return { state, line: spokenLine(state) };
}

// Minimal real player-action wiring. The Node fixture uses a tiny DOM stand-in;
// it does not assert pixel fidelity, browser input, history or persistence.
export function mountStory(rootDocument) {
  const stage = rootDocument.querySelector('main');
  if (!stage) return null;
  let state = initialStory();
  function render() {
    const paragraph = rootDocument.createElement('p');
    paragraph.textContent = spokenLine(state);
    const buttons = legalActions(state).map(action => {
      const button = rootDocument.createElement('button');
      button.type = 'button';
      button.textContent = action;
      button.addEventListener('click', () => {
        state = transition(state, action);
        render();
      });
      return button;
    });
    stage.replaceChildren(paragraph, ...buttons);
  }
  render();
  return () => state;
}

if (typeof document !== 'undefined') mountStory(document);
