---
name: playtest
description: Запуск гри та перевірка — тести симуляції, баланс-бот, завантаження гри без помилок, скріншот. Використовуй, щоб перевірити, що гра працює і грається.
---
# Плейтест

Гра роздається OSPanel: **http://td.local** (збірки немає).

1. Тести + баланс-бот:
   `"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --virtual-time-budget=60000 --dump-dom http://td.local/tests/sim.html | sed -n '/<pre/,/<\/pre>/p'`
   Також `http://td.local/tests/render.html` (смоук-тест рендеру всіх режимів).
   Дивись PASS/FAIL і до якої хвилі доживає бот. Орієнтир: тупий бот гине на хвилях 8–12. Раніше — гра заскладна, пізніше 20+ — занадто легка.
2. Помилки консолі + скріншот:
   `chrome --headless=new --enable-logging=stderr --v=0 --window-size=1500,1000 --screenshot=<scratchpad>/shot.png http://td.local/ 2>&1 | grep -iE "console|uncaught"` — потім переглянь скріншот.
3. Звіт: що пройшло, що впало (з виводом), результати бота по seed, візуальні проблеми.
