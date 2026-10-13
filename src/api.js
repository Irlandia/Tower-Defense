// Client for api/api.php: nickname bound to the player's IP + shared leaderboard.
// The nick is also cached in localStorage so the game works when the API is unreachable.
const BASE = 'api/api.php';
const NICK_KEY = 'pixeltd-nick';

async function call(action, body, params = '') {
  const res = await fetch(`${BASE}?action=${action}${params}`, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: 'немає звʼязку з сервером' }));
  if (!res.ok || data.error) throw new Error(data.error || res.status);
  return data;
}

function cached() {
  try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; }
}
function cache(n) {
  try { localStorage.setItem(NICK_KEY, n); } catch { /* storage unavailable */ }
}

export async function getNick() {
  try {
    const { nick } = await call('nick');
    if (nick) { cache(nick); return nick; }
    // server forgot us (new IP) but the browser remembers: restore it
    const c = cached();
    if (c) return await setNick(c).catch(() => c);
    return '';
  } catch {
    return cached();
  }
}

export async function setNick(n) {
  const { nick } = await call('set_nick', { nick: n });
  cache(nick);
  return nick;
}

// since: unix seconds; 0 = all time. «Захисники місяця» pass the start of the current month.
export async function scores(mode, week = 0, since = 0) {
  return (await call("scores", null, "&mode=" + encodeURIComponent(mode) + "&week=" + week + (since ? "&since=" + since : ""))).scores;
}

// the wardrobe saved a new look: the honour wall shows it for this nick right away
export async function setAvatar(code) {
  return call('set_avatar', { avatar: code });
}

export async function addScore(row) {
  return call('add_score', row);
}
