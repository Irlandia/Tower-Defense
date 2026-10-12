// Scale the canvas as big as the window allows (steps of 0.5), side panel on wide screens.
import { W, H } from '../../render.js';
import { canvas } from '../app.js';
import { resetPopup } from './popup.js';

export function fit() {
  const side = window.innerWidth >= 1000;
  document.body.classList.toggle('side', side);
  const availW = window.innerWidth - (side ? 290 : 24);
  const availH = window.innerHeight - (side ? 24 : 190);
  const scale = Math.max(1, Math.floor(Math.min(availW / W, availH / H) * 2) / 2);
  canvas.style.width = W * scale + 'px';
  canvas.style.height = H * scale + 'px';
  resetPopup();
}
window.addEventListener('resize', fit);
