// Peer-to-peer co-op over WebRTC (PeerJS, free public signaling server — no own backend needed).
// Star topology for up to 4 players: the host holds one connection per guest (slots 1..3), runs the clock
// and broadcasts each tick's command list; guests send their commands to the host and replay its ticks.
const PREFIX = 'pixeltd-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_GUESTS = 3;
const JOIN_TRIES = 3, JOIN_WAIT = 8000; // guest: dial the host up to 3 times, 8 s each
// More ways to find a route between two players: several public STUN servers, plus the PeerJS TURN relay
// as the fallback when a direct link is impossible (strict NAT). PeerJS defaults have only one of each.
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ],
    sdpSemantics: 'unified-plan',
  },
};

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
      this.peer = new window.Peer(PREFIX + code, PEER_OPTS);
      this.peer.on('open', () => { this.status('Чекаємо гравців…'); resolve(code); });
      this.peer.on('error', (e) => {
        // a guest that gave up mid-handshake is not the host's problem; everything else is reported
        if (e.type === 'peer-unavailable') return;
        this.status(errText(e), 'bad'); reject(e);
      });
      // The signaling link (how guests find the room) silently drops when the tab idles or the network blips;
      // without it new guests time out. Reconnect right away, and check it every 20 s as a safety net.
      const peer = this.peer;
      peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 500); });
      clearInterval(this.keepAlive);
      this.keepAlive = setInterval(() => {
        if (this.peer !== peer || peer.destroyed) { clearInterval(this.keepAlive); return; }
        if (peer.disconnected) peer.reconnect();
      }, 20000);
      this.peer.on('connection', (conn) => {
        // a seat is taken only once the link is really open: a guest's stalled attempts must not fill the room
        let slot = 0;
        conn.on('open', () => {
          for (let s = 1; s <= MAX_GUESTS; s++) if (!this.slots[s]) { slot = s; break; }
          if (!slot) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
          this.slots[slot] = { conn, lastMsg: performance.now() };
          if (this.onJoin) this.onJoin(slot);
        });
        conn.on('data', (m) => { if (slot && this.slots[slot] && this.slots[slot].conn === conn) { this.slots[slot].lastMsg = performance.now(); if (this.onMessage) this.onMessage(m, slot); } });
        conn.on('close', () => { if (slot && this.slots[slot] && this.slots[slot].conn === conn) this.drop(slot); });
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS не завантажився (немає інтернету?)'));
      this.role = 'guest';
      const peer = (this.peer = new window.Peer(PEER_OPTS));
      const target = PREFIX + code.trim().toUpperCase();
      let done = false, attempt = 0;
      const fail = (text, err) => { if (done) return; done = true; clearTimeout(this.joinTimer); this.status(text, 'bad'); reject(err); };
      peer.on('error', (e) => fail(errText(e), e));
      // The WebRTC handshake sometimes just stalls (a lost ICE candidate, a busy relay). Instead of waiting it out,
      // drop the attempt and dial again: a fresh try usually goes through. Only after every try do we give up.
      const dial = () => {
        if (done || this.peer !== peer) return;
        attempt++;
        if (attempt > 1) this.status(`Не вийшло з першого разу — спроба ${attempt} з ${JOIN_TRIES}…`);
        const conn = peer.connect(target, { reliable: true });
        this.conn = conn;
        this.joinTimer = setTimeout(() => {
          if (conn.open || done) return;
          try { conn.close(); } catch { /* never opened */ }
          if (attempt < JOIN_TRIES) dial();
          else fail("Не вдалося з'єднатися з кімнатою. Перевір код, попроси хоста перестворити кімнату або спробуй іншу мережу", new Error('timeout'));
        }, JOIN_WAIT);
        conn.on('open', () => {
          if (done || this.conn !== conn) { try { conn.close(); } catch { /* a stale attempt */ } return; }
          done = true; clearTimeout(this.joinTimer);
          this.status('Підключено до кімнати', 'good'); resolve();
        });
        conn.on('data', (m) => { if (this.conn === conn && this.onMessage) this.onMessage(m, 0); });
        conn.on('close', () => { if (this.conn === conn && done && this.onLeave) this.onLeave(0); });
      };
      peer.on('open', dial);
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
    clearInterval(this.keepAlive); clearTimeout(this.joinTimer);
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
