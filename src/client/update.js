// New releases reach players who keep the game open: compare this page's build id (stamped into
// index.html on deploy) with build.json on the server — at boot, every 2 minutes and when the tab
// comes back. Outside a run the page reloads by itself; during a run (or in a co-op room) a bar
// offers the update so nobody loses their game. Local copies (build "dev") never check.
import { app, net, bus } from './app.js';

const meta = document.querySelector('meta[name="build"]');
const MINE = meta ? meta.content : 'dev';
let pending = false;

async function latest() {
  try {
    const r = await fetch(`build.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).build || null;
  } catch { return null; } // offline / blocked: try again later
}

function bar() {
  let el = document.getElementById('updateBar');
  if (el) return;
  el = document.createElement('div');
  el.id = 'updateBar';
  el.innerHTML = '✨ Вийшло оновлення гри <button>Оновити</button>';
  el.querySelector('button').addEventListener('click', () => location.reload());
  document.body.append(el);
}

// a quiet moment: not in a run, not in a co-op room (reloading would drop the partner)
const idle = () => !app.running && !(net.online);

async function check() {
  if (MINE === 'dev' || pending) return;
  const b = await latest();
  if (!b || b === MINE) return;
  pending = true;
  if (idle()) location.reload();
  else bar();
}

if (MINE !== 'dev') {
  check();
  setInterval(check, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  // an update found during a run: apply it as soon as the player is back in the menu
  bus.on('menu:show', () => { if (pending && idle()) location.reload(); });
}
