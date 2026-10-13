// End-of-run modal: result, XP, campaign stars/story, leaderboard submission, next steps.
import { CAMPAIGN, BOSSES } from '../../sim/data.js';
import * as Api from '../../api.js';
import * as Meta from '../../meta.js';
import { app, bus, net, meta, me, P } from '../app.js';
import { $, esc } from '../dom.js';
import { others } from '../roster.js';
import { newRun, send, enterLobby } from '../session.js';
import { hero } from '../../say.js';

// "New in the bestiary" line: bosses met / beaten for the first time, better medals.
function bestiaryLine(b) {
  if (!b) return '';
  const names = (ks) => ks.filter((k) => BOSSES[k]).map((k) => esc(BOSSES[k].name)).join(', ');
  const parts = [];
  if (b.killed.length) parts.push(`переможено вперше: <b>${names(b.killed)}</b>`);
  const met = b.seen.filter((k) => !b.killed.includes(k));
  if (met.length) parts.push(`зустрінуто: <b>${names(met)}</b>`);
  if (b.medal.length) parts.push(`краща рамка: <b>${names(b.medal)}</b>`);
  return parts.length ? `<p class="bst-new">📖 Бестіарій — ${parts.join(' · ')}</p>` : '';
}

bus.on('run:end', ({ won, earned, record, level, levelUp, bestiary }) => {
  const s = app.state;
  const M = s.mission;
  const farmLost = s.farmMax && s.farmHp <= 0;
  const title = won ? 'ПЕРЕМОГА!' : farmLost ? 'Врожай витоптано' : s.endless ? 'Нескінченність скінчилась' : s.mode === 'circle' ? 'Коло переповнене' : 'Замок впав';
  const canContinue = won && s.mode === 'circle' && !M && net.role !== 'guest';
  const m = $('modal');
  // campaign: stars, the story's closing line and the way on
  let camp = '';
  if (M) {
    const st = won ? s.stars : 0;
    const next = CAMPAIGN.find((x) => x.id === M.id + 1);
    camp = `<p class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</p>
      <p class="hint">★ перемога · ★ ${esc(M.side.text)} · ★ ранній виклик хвиль ×${M.early}</p>
      ${won ? `<p class="outro"><b>${esc(hero(M.story.outro[0]))}:</b> «${esc(hero(M.story.outro[1]))}»</p>` : ""}
      ${won && next && net.role !== 'guest' ? '<button id="nextMission" class="big primary">Наступна місія ▶</button>' : ''}
      ${won && !next ? '<p class="rec">Кампанію пройдено! Долина врятована.</p>' : ''}`;
  }
  m.innerHTML = `<h2 class="${won ? 'win' : ''}">${M ? `Місія ${M.id}. ` : ''}${title}</h2>${camp}
    <p>Хвиля <b>${s.wave}</b>${s.endless ? ' (нескінченний)' : ' / ' + s.winWave} · Вбито <b>${s.kills}</b>${s.players.length > 1 ? ` (ти: ${P().kills})` : ''}${record ? ' · <span class="rec">Новий рекорд!</span>' : ''}</p>
    <p class="crys">+${earned} ✦ досвіду <span>(рівень ${level}${level < Meta.MAX_LEVEL ? "" : " · макс."})</span></p>
    ${levelUp ? `<p class="rec">▲ Новий рівень ${level}! Ще одне очко таланту</p>` : ""}
    ${bestiaryLine(bestiary)}
    <p id="scoreMsg">${M ? '' : app.nick ? 'Надсилаємо результат…' : 'Введи нік у меню, щоб потрапити в таблицю лідерів'}</p>
    <div class="row">${canContinue ? '<button id="endless" class="big primary">Продовжити ∞</button>' : ''}${net.role === 'guest' ? (won && s.mode === 'circle' ? '<p>Хост вирішує: продовжити чи ні…</p>' : '<p>Чекаємо, поки хост почне нову гру…</p>') : '<button id="again" class="big">Ще раз</button>'}<button id="menuBtn" class="big">Меню</button></div>`;
  m.classList.remove('hidden');
  if ($('again')) $('again').addEventListener('click', newRun);
  if ($('nextMission')) $('nextMission').addEventListener('click', () => { app.selectedMission = M.id + 1; newRun(); });
  if ($('endless')) $('endless').addEventListener('click', () => send({ type: 'continue' }));
  $('menuBtn').addEventListener('click', () => enterLobby());
  if (app.nick && !M) { // campaign missions are not leaderboard runs
    Api.addScore({ mode: s.opts.mode === 'brawl' ? 'brawl' : s.casino ? 'casino' : s.mode, week: s.opts.week, diff: s.opts.diff, wave: s.wave, kills: s.kills, won, coop: s.players.length > 1, partner: others(), avatar: meta.avatar && meta.avatar.code ? meta.avatar.code : '' })
      .then((r) => { $('scoreMsg').textContent = `Результат у таблиці лідерів: ${r.score} очок`; })
      .catch((e) => { $('scoreMsg').textContent = 'Таблиця лідерів недоступна: ' + e.message; });
  }
});
