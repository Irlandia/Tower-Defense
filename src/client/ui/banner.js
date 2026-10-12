// Centre-screen banner (wave starts, boss intros, bonuses). Also reachable through the bus: bus.emit('banner', ...).
import { $ } from '../dom.js';
import { bus } from '../app.js';

let timer = 0;

export function banner(text, cls = '', sub = '', ms = 1600) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(text);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.className = 'show ' + cls;
  clearTimeout(timer);
  timer = setTimeout(() => { b.className = ''; }, ms);
}

bus.on('banner', banner);
