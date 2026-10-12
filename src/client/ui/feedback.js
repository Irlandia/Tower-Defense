// Presentation reactions to simulation events and run lifecycle events: sounds, banners, UI resets.
// No game rules here — flow decisions are made in session.js / loop.js.
import { BOSSES, SEASONS, bossFor, DAY } from '../../sim/data.js';
import { dayPhase } from '../../sim/sim.js';
import { app, bus, net, sfx, music, me } from '../app.js';
import { $, hide } from '../dom.js';
import { nickOf } from '../roster.js';
import { banner } from './banner.js';
import { buildToolbar, buildAbilities, resetInfo } from './hud.js';
import { resetPopup } from './popup.js';
import { openTalent } from './talents.js';
const DAY_TEXT = { day: 'Настав день', evening: 'Вечоріє', night: 'Настала ніч: вежі бачать ближче, золота більше', dawn: 'Світає' };

bus.on('run:start', () => {
  const s = app.state;
  music.play(s.season);
  setTimeout(() => {
    const st = app.state;
    if (st.mission) banner(`Місія ${st.mission.id}: ${st.mission.title}`, 'boss intro', `вистояти ${st.winWave} хвиль · ★ ${st.mission.side.text}`, 2600);
    else if (st.brawl) banner(`${st.brawl.icon} ${st.brawl.name.toUpperCase()}`, 'boss intro', st.brawl.desc, 3200);
    else banner(SEASONS[st.season].name.toUpperCase(), 'gold', 'сезон', 1800);
  }, 200);
  $('speed').textContent = 'x1';
  $('pause').textContent = '❚❚';
  hide('modal'); hide('menu');
  document.body.classList.remove('in-menu');
  resetInfo(); resetPopup();
  buildToolbar();
  buildAbilities();
  document.body.classList.toggle('guest', net.role === 'guest');
});

bus.on('run:resume', () => {
  hide('menu');
  document.body.classList.remove('in-menu');
  resetPopup(); resetInfo();
});

bus.on('run:endless', () => {
  hide('modal');
  sfx.play('wave');
  banner('НЕСКІНЧЕННІСТЬ', 'boss intro', 'Хвилі важчають, боси частішають', 2600);
});

// During a silent catch-up loop.js passes only the flow events (gameover, victory, draft), so this stays cheap.
bus.on('sim:events', (events) => {
  const mine = (e) => e.p === undefined || e.p === me();
  for (const e of events) {
    switch (e.type) {
      case 'shoot': sfx.play(e.kind); break;
      case 'zap': sfx.play('zap'); break;
      case 'hit': sfx.play('hit'); break;
      case 'death': sfx.play('death'); if (e.kind === 'boss' || e.kind === 'king') app.freezeUntil = performance.now() + 150; break;
      case 'explode': case 'steam': case 'barrel': sfx.play('explode'); break;
      case 'meteor': sfx.play('meteor'); app.freezeUntil = performance.now() + 80; break;
      case 'build': case 'upgrade': case 'clear': sfx.play('build'); break;
      case 'evolve': sfx.play('card'); resetPopup(); break;
      case 'sell': case 'coin': case 'chest': if (mine(e)) sfx.play('sell'); break;
      case 'leak': case 'stolen': sfx.play('leak'); break;
      case 'lap': sfx.play('click'); break;
      case 'wave':
        sfx.play('wave');
        {
          // a new time of day starts with this wave: say so under the wave title
          const s = app.state, dp = DAY.phases[dayPhase(s)];
          const turn = e.wave > 1 && (e.wave - 1) % DAY.every === 0 && !(s.mission && s.mission.night);
          const sub = turn ? `${dp.icon} ${DAY_TEXT[dp.id]}` : '';
          banner(e.final ? 'ФІНАЛЬНА ХВИЛЯ!' : e.boss ? `Хвиля ${e.wave} — БОС!` : `Хвиля ${e.wave}`, e.boss ? 'boss' : '', sub, sub ? 2400 : 1600);
        }
        break;
      case 'bossSpawn': case 'bossReveal': {
        if (e.hidden) break; // Перевертень: no intro until he drops the mask
        const info = e.bk ? BOSSES[e.bk] : bossFor(e.wave);
        sfx.play('rumble');
        banner(info.name.toUpperCase(), 'boss intro', info.title, 2600);
        break;
      }
      case 'bossRage': sfx.play('leak'); break;
      case 'nova': sfx.play('frost'); sfx.play('explode'); break;
      case 'quake': sfx.play('rumble'); break;
      case 'goldrain': if (mine(e)) sfx.play('sell'); break;
      case 'overdrive': if (mine(e)) { sfx.play('card'); banner('ОВЕРДРАЙВ!', 'gold', 'твої вежі стріляють швидше', 1600); } break;
      case 'wallup': case 'wallbreak': sfx.play('cannon'); break;
      case 'bonus': if (mine(e)) banner(`+${e.gold} золота`, 'gold'); break;
      // co-op pranks
      case 'roulette': {
        const lucky = e.p === me();
        sfx.play(lucky ? 'card' : 'leak');
        banner(lucky ? 'РУЛЕТКА: +250 ТОБІ!' : `Рулетка: ${nickOf(e.p)} виграв 250`, 'gold', e.by === me() ? 'ти крутив' : `крутив ${nickOf(e.by)}`, 2200);
        break;
      }
      case 'steal':
        if (e.from === me()) { sfx.play('leak'); banner(`${nickOf(e.p)} поцупив у тебе ${e.gold}!`, 'gold', 'кишеньковий злодій', 1800); }
        else if (e.p === me()) banner(`Поцупив у друга +${e.gold} 😏`, 'gold', '', 1500);
        break;
      case 'draft':
        if (e.p === me()) { sfx.play('card'); if (!net.online && !app.talentOpen) openTalent(); }
        break;
      case 'gameover': sfx.play('gameover'); break;
      case 'victory': sfx.play('card'); break;
    }
  }
});
