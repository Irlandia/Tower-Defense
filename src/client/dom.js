// Tiny DOM helpers shared by the UI modules.
export const $ = (id) => document.getElementById(id);
export const hide = (id) => $(id).classList.add('hidden');
export const show = (id) => $(id).classList.remove('hidden');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape a user-controlled string (nicks, partner names) before putting it into innerHTML. */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
