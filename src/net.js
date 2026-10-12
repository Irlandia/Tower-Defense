// Peer-to-peer co-op over WebRTC (PeerJS, free public signaling server — no own backend needed).
// Star topology for up to 4 players: the host holds one connection per guest (slots 1..3), runs the clock
// and broadcasts each tick's command list; guests send their commands to the host and replay its ticks.
const PREFIX = 'pixeltd-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_GUESTS = 3;

// 5 symbols from a 32-letter alphabet, unpredictable (crypto RNG) so rooms cannot be guessed by a script.
// Rejection sampling is unnecessary: 256 is a multiple of 32, so the modulo is unbiased.
function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class Net {
  constructor() {
    this.role = 'solo'; // 'solo' | 'host' | 'guest'
    this.peer = null;
    this.conn = null; // guest: connection to the host
    this.slots = {}; // host: slot -> { conn, lastMsg }
    this.inbox = [];
    this.onMessage = null; // (msg, slot) — slot is 0 for messages from the host
    this.onStatus = null;
    this.onJoin = null; // host: (slot)
    this.onLeave = null; // host: (slot) / guest: (0)
  }

  get online() { return this.role !== 'solo'; }
  get connected() {
    if (this.role === 'host') return this.guestSlots().length > 0;
    return !!(this.conn && this.conn.open);
  }
  guestSlots() {
    return Object.keys(this.slots).map(Number).filter((s) => this.slots[s].conn.open).sort();
  }

  status(text, kind = '') { if (this.onStatus) this.onStatus(text, kind); }

  host() {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS не завантажився (немає інтернету?)'));
      const code = roomCode();
      this.role = 'host';
      this.peer = new window.Peer(PREFIX + code);
      this.peer.on('open', () => { this.status('Чекаємо гравців…'); resolve(code); });
      this.peer.on('error', (e) => { this.status(errText(e), 'bad'); reject(e); });
      this.peer.on('connection', (conn) => {
        let slot = 0;
        for (let s = 1; s <= MAX_GUESTS; s++) if (!this.slots[s]) { slot = s; break; }
        if (!slot) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
        this.slots[slot] = { conn, lastMsg: performance.now() };
        conn.on('open', () => { if (this.onJoin) this.onJoin(slot); });
        conn.on('data', (m) => { if (this.slots[slot]) this.slots[slot].lastMsg = performance.now(); if (this.onMessage) this.onMessage(m, slot); });
        conn.on('close', () => this.drop(slot));
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS не завантажився (немає інтернету?)'));
      this.role = 'guest';
      this.peer = new window.Peer();
      this.peer.on('error', (e) => {
        clearTimeout(this.joinTimer);
        this.status(errText(e), 'bad');
        reject(e);
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        this.conn = conn;
        // a direct WebRTC link can silently fail behind strict NAT / firewalls: tell the player instead of hanging
        this.joinTimer = setTimeout(() => {
          if (conn.open) return;
          this.status("Не вдалося з'єднатися напряму (фаєрвол або сувора NAT). Спробуй іншу мережу чи нехай кімнату створить друг", 'bad');
          try { conn.close(); } catch { /* never opened */ }
          reject(new Error('timeout'));
        }, 15000);
        conn.on('open', () => { clearTimeout(this.joinTimer); this.status('Підключено до кімнати', 'good'); resolve(); });
        conn.on('data', (m) => { if (this.onMessage) this.onMessage(m, 0); });
        conn.on('close', () => { if (this.onLeave) this.onLeave(0); });
      });
    });
  }

  // host: forget a guest slot (closed, timed out or kicked)
  drop(slot) {
    const s = this.slots[slot];
    if (!s) return;
    delete this.slots[slot];
    try { s.conn.close(); } catch { /* already closed */ }
    if (this.onLeave) this.onLeave(slot);
  }

  // host: to every guest; guest: to the host
  send(m) {
    if (this.role === 'host') { for (const s of this.guestSlots()) this.slots[s].conn.send(m); }
    else if (this.conn && this.conn.open) this.conn.send(m);
  }
  sendTo(slot, m) {
    const s = this.slots[slot];
    if (s && s.conn.open) s.conn.send(m);
  }
  // host: to every guest except one (relaying)
  sendExcept(slot, m) {
    for (const s of this.guestSlots()) if (s !== slot) this.slots[s].conn.send(m);
  }

  leave() {
    if (this.peer) this.peer.destroy();
    this.peer = null; this.conn = null; this.slots = {}; this.role = 'solo'; this.inbox = [];
  }
}

// PeerJS error types -> a sentence a player understands.
function errText(e) {
  const t = e && e.type;
  return {
    'peer-unavailable': 'Кімнату не знайдено — перевір код (або хост уже вийшов)',
    network: "Немає з'єднання із сервером кімнат. Перевір інтернет",
    'server-error': 'Сервер кімнат недоступний. Спробуй за хвилину',
    'socket-error': "Обірвалося з'єднання із сервером кімнат",
    'unavailable-id': 'Такий код уже зайнятий — створи кімнату ще раз',
    'browser-incompatible': 'Цей браузер не підтримує WebRTC — спробуй Chrome чи Firefox',
    webrtc: "Помилка WebRTC — спробуй іншу мережу",
  }[t] || 'Помилка мережі: ' + (t || e);
}
