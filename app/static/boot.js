/* Nyaai — start-up: decide between setup, invite, sign-in and the app. Loaded last. */
'use strict';

async function start() {
  const raw = location.hash.replace(/^#/, '');
  if (raw.startsWith('/accept')) {
    const tok = new URLSearchParams(raw.split('?')[1] || '').get('token');
    return showAuth('accept', tok);
  }
  let st; try { st = await api('/auth/status'); } catch { st = { has_users: true }; }
  if (!st.has_users) return showAuth('setup');
  try { S.me = await api('/auth/me'); } catch { return showAuth('login'); }
  hideAuth();
  try { S.health = await api('/health'); } catch { S.health = {}; }
  renderTop(); renderNav(currentNav); renderNotice();
  await route();
  refreshCounts();
}

(function boot() {
  applyTheme(store.get('theme', 'light'));
  $('#today').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
