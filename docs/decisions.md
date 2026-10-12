# Рішення

## 2026-10-12 — шарова архітектура клієнта і розбиття симуляції
- **Контекст:** `main.js` (1262 р.) і `sim.js` (1064 р.) — «god-modules» з прихованими залежностями за порядком виконання.
- **Рішення:** `sim` = data → rng → mapgen → queries → combat → waves → commands → sim; клієнт = `app`+`bus` + `session/loop/netplay` + `ui/*`. Повний опис — `architecture.md`.
- **Патерни:** Command (таблиця обробників), Observer (bus), Facade (`sim.js` ре-експортує API), Singleton-контекст (`app`).
- **Наслідки:** вивід `tests/sim.html` ідентичний до рефакторингу; `VERSION` 38 (валідація координат у командах); мережеві повідомлення валідуються (`protocol.js`).
- **Відкладено:** див. `code-review.md` (SRI для PeerJS, сіль для хешу IP, індекси сітки).
