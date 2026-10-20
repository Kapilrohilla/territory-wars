import { createSession } from './game/session';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const session = createSession(canvas, {
  seed: Date.now(),
  humanName: 'You',
  humanColor: 0,
  onOver: (w) => console.log(w.won ? 'Territory Wars: you win!' : 'Territory Wars: game over', w),
});
session.start();
