let score = 0;
document.getElementById('play').addEventListener('click', () => {
  document.getElementById('score').textContent = String(++score);
});
