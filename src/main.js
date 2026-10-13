// Client entry point: wires the modules together and starts the loop. No logic lives here.
// Architecture: docs/architecture.md. Import order below matters for `frame` handlers
// (overlay draws before the HUD refreshes) — handlers run in registration order.
import './client/app.js';
import './client/netplay.js'; // registers the net.* callbacks
import './client/ui/banner.js';
import './client/ui/cursors.js';
import './client/ui/input.js';
import './client/ui/overlay.js';
import './client/ui/hud.js';
import './client/ui/story.js';
import './client/ui/feedback.js';
import './client/ui/endscreen.js';
import './client/ui/menu.js';
import './client/ui/tutorial.js';
import './client/update.js'; // new releases reach players who keep the game open
import { fit } from './client/ui/layout.js';
import { buildToolbar, buildAbilities } from './client/ui/hud.js';
import { startLoop } from './client/loop.js';
import { enterLobby } from './client/session.js';
import { runDemoIfRequested } from './client/debug.js';

buildToolbar();
buildAbilities();
fit();
if (!runDemoIfRequested()) enterLobby();
startLoop();

// the game is ready: fade the boot screen out (it lives in index.html so it shows before any module loads)
const boot = document.getElementById('boot');
if (boot) { boot.classList.add("done"); setTimeout(() => boot.remove(), 600); } // a timer, not rAF: hidden tabs get no frames
