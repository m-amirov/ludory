const scenes = {
  start: { text: 'The road divides at sunset.', choices: [['Take the forest road', 'forest'], ['Follow the river', 'river']] },
  forest: { text: 'Fireflies guide you home.', choices: [['Start again', 'start']] },
  river: { text: 'A boat waits in the moonlight.', choices: [['Start again', 'start']] },
};

function showScene(id) {
  const scene = scenes[id];
  document.getElementById('line').textContent = scene.text;
  const choices = document.getElementById('choices');
  choices.replaceChildren();
  for (const [label, destination] of scene.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => showScene(destination));
    choices.append(button);
  }
}

showScene('start');
