// «Шафа з дзеркалом»: the avatar editor. A draft is edited freely (undo, random); «Зберегти» writes meta.avatar,
// tells the co-op room and returns to the menu. Everything is cosmetic: the game never reads the avatar.
import * as Meta from '../../meta.js';
import { app, bus, meta, net } from '../app.js';
import { esc } from '../dom.js';
import { VERSION } from '../../sim/data.js';
import * as Api from '../../api.js';
import { FIELDS, NAMES, SKIN, HAIR, EYE, CLOTH, DEFAULT, normalize, parse, serialize, randomSpec, lockOf, sprite, mini, portrait } from '../../avatar.js';

const CATS = [
  ['hair', 'Зачіска', 'N'], ['hairC', 'Колір волосся', HAIR], ['skin', 'Шкіра', SKIN], ['eyes', 'Очі', EYE],
  ['shirt', 'Сорочка', 'N'], ['shirtC', 'Колір сорочки', CLOTH], ['pants', 'Штани', 'N'], ['pantsC', 'Колір штанів', CLOTH],
  ['hat', 'Головний убір', 'N'], ['acc', 'Додатки', 'N'],
];
let draft = null, hist = [], cat = 0, msg = '';

/** The avatar saved in the profile (the default look until the wardrobe is used). */
export const savedAvatar = () => (meta.avatar && meta.avatar.code ? parse(meta.avatar.code) : { ...DEFAULT });
export const avatarCode = () => serialize(savedAvatar());
const progress = () => ({ campaign: meta.campaign, level: Meta.level(meta) });

function reset() { draft = null; hist = []; msg = ''; }
bus.on('menu:tab', (tab) => { if (tab !== 'wardrobe') reset(); });
bus.on('menu:show', reset);

function announce() {
  // the host/guest greet again so the room sees the new look
  if (net.online) net.send({ t: 'hello', nick: app.nick, v: VERSION, perks: Meta.perks(meta), avatar: avatarCode() });
  bus.emit('avatar:changed');
}

export function renderWardrobe(el) {
  if (!draft) draft = savedAvatar();
  const prog = progress();
  const progressTxt = (k, v) => lockOf(k, v, prog);
  el.innerHTML = `<div class="wr">
    <div class="wr-mirror"><div class="wr-glass"><canvas id="wrBig"></canvas></div>
      <b class="wr-name">${esc(app.nick || 'Ти')}</b>
      <div class="wr-minirow"><canvas id="wrMini" width="28" height="44"></canvas><small>так тебе бачать на дворі й біля вогнища</small></div></div>
    <div class="wr-panel"><div class="wr-tabs"></div><div class="wr-grid"></div>
      <div class="wr-actions"><button id="wrRnd">🎲 Випадково</button><button id="wrUndo">↶ Назад</button>
        <button id="wrCancel">Скасувати</button><button id="wrSave" class="primary">✓ Зберегти</button></div>
      <small class="wr-hint">${esc(msg || 'Це лише вигляд: на гру й рейтинг він не впливає. Деякі речі відкриваються за історію гри.')}</small></div></div>`;
  // mirror (portrait ×8 + miniature)
  const big = el.querySelector('#wrBig'), pc = portrait(draft, 8);
  big.width = pc.width; big.height = pc.height; big.getContext('2d').drawImage(pc, 0, 0);
  const mc = el.querySelector('#wrMini').getContext('2d');
  mc.imageSmoothingEnabled = false; mc.clearRect(0, 0, 28, 44); mc.drawImage(mini(draft), 0, 0, 28, 44);
  // category tabs
  const tabs = el.querySelector('.wr-tabs');
  CATS.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c[1];
    b.className = i === cat ? 'on' : '';
    b.addEventListener('click', () => { cat = i; renderWardrobe(el); });
    tabs.append(b);
  });
  // options of the current category
  const [key, , pal] = CATS[cat], grid = el.querySelector('.wr-grid');
  const count = FIELDS.find((f) => f[0] === key)[1];
  for (let v = 0; v < count; v++) {
    const lock = progressTxt(key, v);
    const b = document.createElement('button');
    b.className = 'wr-opt' + (draft[key] === v ? ' on' : '') + (lock ? ' locked' : '');
    b.dataset.v = v;
    if (pal !== 'N') {
      const d = document.createElement('i'); d.style.background = pal[v]; b.append(d);
      b.title = `Колір ${v + 1}`;
    } else {
      b.append(portrait({ ...draft, [key]: v }, 2));
      b.title = NAMES[key][v] + (lock ? ` — 🔒 ${lock}` : '');
      const lab = document.createElement('small'); lab.textContent = lock ? '🔒 ' + lock : NAMES[key][v]; b.append(lab);
    }
    b.disabled = !!lock;
    b.addEventListener('click', () => { hist.push({ ...draft }); draft = { ...draft, [key]: v }; msg = ''; renderWardrobe(el); });
    grid.append(b);
  }
  el.querySelector('#wrRnd').addEventListener('click', () => { hist.push({ ...draft }); draft = randomSpec(Math.random, prog); msg = 'Гарно! А якщо ще раз?'; renderWardrobe(el); });
  el.querySelector('#wrUndo').addEventListener('click', () => { if (hist.length) { draft = hist.pop(); renderWardrobe(el); } });
  el.querySelector('#wrCancel').addEventListener('click', () => { reset(); bus.emit('menu:goto', 'play'); });
  el.querySelector('#wrSave').addEventListener('click', () => {
    meta.avatar = { code: serialize(normalize(draft)), set: true };
    Meta.save(meta);
    reset();
    announce();
    if (app.nick) Api.setAvatar(meta.avatar.code).catch(() => { /* offline: the wall catches up with the next result */ });
    bus.emit('menu:goto', 'play');
    bus.emit('avatar:saved');
  });
}
void sprite;
