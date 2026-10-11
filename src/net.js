// Peer-to-peer co-op over WebRTC (PeerJS, free public signaling server — no own backend needed).
// Host-authoritative lockstep: the host runs the clock and broadcasts each tick's command list;
// the guest sends its commands to the host and replays the host's ticks with the same seed.
const PREFIX = 'pixeltd-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Net {
  constructor() {
    this.role = 'solo'; // 'solo' | 'host' | 'guest'
    this.peer = null;
    this.conn = null;
    this.inbox = [];
    this.onMessage = null;
    this.onStatus = null;
  }

  get online() { return this.role !== 'solo'; }
  get connected() { return !!(this.conn && this.conn.open); }

  status(text, kind = '') { if (this.onStatus) this.onStatus(text, kind); }

  host() {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS не завантажився (немає інтернету?)'));
      const code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
      this.role = 'host';
      this.peer = new window.Peer(PREFIX + code);
      this.peer.on('open', () => { this.status('Чекаємо друга…'); resolve(code); });
      this.peer.on('error', (e) => { this.status('Помилка: ' + e.type, 'bad'); reject(e); });
      this.peer.on('connection', (conn) => {
        if (this.connected) { conn.close(); return; } // only one partner
        this.attach(conn);
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS не завантажився (немає інтернету?)'));
      this.role = 'guest';
      this.peer = new window.Peer();
      this.peer.on('error', (e) => {
        this.status(e.type === 'peer-unavailable' ? 'Кімнату не знайдено' : 'Помилка: ' + e.type, 'bad');
        reject(e);
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        this.attach(conn);
        conn.on('open', () => resolve());
      });
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.status('Друг підключився', 'good'));
    conn.on('data', (m) => { if (this.onMessage) this.onMessage(m); });
    conn.on('close', () => this.status('Друг відключився', 'bad'));
  }

  send(m) {
    if (this.connected) this.conn.send(m);
  }

  leave() {
    if (this.peer) this.peer.destroy();
    this.peer = null; this.conn = null; this.role = 'solo'; this.inbox = [];
  }
}
