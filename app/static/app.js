/* Nyaay — Chambers UI. Vanilla JS, no build step. Hash routes: #/, #/research, #/j/<id>, #/matters, #/m/<id>/<tab>, ... */
'use strict';

/* ================================================================ core */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const store = {
  get(k, d) { try { const v = localStorage.getItem('nyaai.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nyaai.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

async function api(path, o = {}) {
  const headers = { 'X-Requested-With': 'nyaai' };
  let body = o.form;
  if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
  const r = await fetch(path, { method: o.method || (body ? 'POST' : 'GET'), headers, body });
  if (r.status === 401 && !path.startsWith('/auth/')) { showAuth('login'); throw new Error('Please sign in'); }
  if (o.raw) return r;
  if (r.status === 204) return null;
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) {
    const msg = typeof d === 'object' ? (Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail) : t;
    throw new Error(msg || ('Request failed: ' + r.status));
  }
  return d;
}

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3200);
}
const fail = e => { console.error(e); toast(e.message || String(e), true); };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = s => { if (!s) return '—'; const d = parseISO(s); return isNaN(d) ? s : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const TODAY = iso(new Date());
const daysTo = s => Math.round((parseISO(s) - parseISO(TODAY)) / 864e5);
function relDay(s) {
  const n = daysTo(s);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts + (ts.endsWith('Z') ? '' : 'Z'))) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
function dayPill(s) {
  const n = daysTo(s);
  const cls = n < 0 ? 'bad' : n <= 3 ? 'warn' : 'neutral';
  const t = n < 0 ? `${-n}d overdue` : n === 0 ? 'Due today' : `${n}d left`;
  return `<span class="pill ${cls} days">${t}</span>`;
}
function copy(text, what = 'Copied') { navigator.clipboard?.writeText(text).then(() => toast(what), () => toast('Copy failed', true)); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/* ================================================================ icons */
const P = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  wand: '<path d="m4 20 11-11M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/>',
  seal: '<path d="M12 3 4 7v2h16V7z"/><path d="M6 9v8M10 9v8M14 9v8M18 9v8M3 20h18"/>',
};
const I = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

/* ================================================================ state */
const S = { health: null, me: null, matters: [], counts: {}, playbook: null, templates: null, reviews: null };
const isAdmin = () => ['owner', 'admin'].includes(S.me?.user?.role);
const canDecide = () => S.me?.user?.role !== 'clerk';
async function loadMatters() { S.matters = await api('/matters'); return S.matters; }
async function loadPlaybook() { if (!S.playbook) S.playbook = await api('/playbooks/ni138'); return S.playbook; }
async function loadTemplates() { if (!S.templates) S.templates = await api('/drafts/templates'); return S.templates; }
const matterTitle = id => (S.matters.find(m => m.id === id) || {}).title || ('Matter #' + id);
const stageName = id => ((S.playbook?.stages || []).find(s => s.id === id) || {}).name;

/* ================================================================ theme */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn').innerHTML = I(t === 'dark' ? 'sun' : 'moon');
  store.set('theme', t);
}
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ================================================================ nav */
const NAV = [
  ['Overview', [['dash', '#/', 'home', 'Dashboard']]],
  ['Research', [['research', '#/research', 'search', 'Search & Ask'], ['saved', '#/saved', 'bookmark', 'Saved authorities']]],
  ['Practice', [['matters', '#/matters', 'brief', 'Matters'], ['calendar', '#/calendar', 'cal', 'Calendar'],
    ['approvals', '#/approvals', 'inbox', 'Approvals'], ['drafts', '#/drafts', 'pen', 'Drafting'], ['clients', '#/clients', 'users', 'Clients']]],
  ['Tools', [['check', '#/check', 'shield', 'Citation check'], ['settings', '#/settings', 'gear', 'Settings']]],
];
function renderNav(active) {
  const h = S.health || {};
  const ai = h.llm && h.llm !== 'none';
  $('#nav').innerHTML = `
    <div class="brand"><div class="seal">${I('scale')}</div><div><div class="name">Nyaay</div><div class="tag">Chambers · India</div></div></div>
    ${NAV.map(([sec, items]) => `<div class="nav-sec"><h6>${sec}</h6>${items.map(([k, href, ic, label]) =>
      `<button class="nav-item ${k === active ? 'on' : ''}" onclick="location.hash='${href}';document.getElementById('nav').classList.remove('open')">${I(ic)}<span>${label}</span>${k === 'approvals' && S.counts.pending_approvals ? `<span class="count">${S.counts.pending_approvals}</span>` : ''}</button>`).join('')}</div>`).join('')}
    <div class="nav-foot">
      <div class="firm">${esc(S.me?.firm?.name || '')}</div>
      <div style="margin-top:6px"><span class="dot ${ai ? 'on' : 'off'}"></span>${ai ? 'AI: ' + esc(h.model || 'connected') : 'AI not connected'}</div>
      <div style="margin-top:3px"><span class="dot ${h.real_judgments ? 'on' : 'off'}"></span>${h.real_judgments ? Number(h.real_judgments).toLocaleString('en-IN') + ' judgments' : 'Demo judgments only'}</div>
    </div>`;
}
function renderNotice() {
  const h = S.health || {}; const msgs = [];
  if (h.index_is_fixture) msgs.push(`Only 3 fictional test judgments are loaded. Load real Supreme Court judgments: <code>python -m app.ingest sc --years 2024</code>`);
  if (h.llm === 'none') msgs.push(`AI is not connected — search, reader and drafting work; written answers, summaries and AI polish need Ollama running (<code>ollama pull qwen3:8b</code>).`);
  $('#notice').innerHTML = msgs.length && !store.get('noticeHidden', false) ? `<div class="notice">${I('alert')}<div class="grow">${msgs.join('<br>')}</div><button class="btn ghost sm" onclick="store.set('noticeHidden',true);renderNotice()">Dismiss</button></div>` : '';
}
async function refreshCounts() {
  try { const d = await api('/dashboard'); S.counts = d.counts; renderNav(currentNav); } catch { /* ignore */ }
}

/* ================================================================ modal & palette */
function modal(title, body, { ok, okText = 'Save', wide = false, foot = true, cancelText = 'Cancel' } = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog"><div class="modal-h"><h3>${title}</h3><button class="btn ghost sm" style="margin-left:auto" data-x>${I('x')}</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f"><button class="btn" data-x>${cancelText}</button>${ok ? `<button class="btn primary" data-ok>${okText}</button>` : ''}</div>` : ''}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  $$('[data-x]', ov).forEach(b => b.onclick = close);
  const okBtn = $('[data-ok]', ov);
  if (okBtn) okBtn.onclick = async () => {
    okBtn.disabled = true;
    try { if (await ok(ov) !== false) close(); } catch (e) { fail(e); } finally { okBtn.disabled = false; }
  };
  document.body.appendChild(ov);
  setTimeout(() => { const f = $('input,textarea,select', $('.modal-b', ov)); if (f) f.focus(); }, 30);
  return { el: ov, close };
}
const PALETTE_STATIC = [
  ['Dashboard', '#/', 'home'], ['Search & Ask', '#/research', 'search'], ['Saved authorities', '#/saved', 'bookmark'],
  ['Matters', '#/matters', 'brief'], ['Calendar', '#/calendar', 'cal'], ['Approvals', '#/approvals', 'inbox'],
  ['Drafting', '#/drafts', 'pen'], ['Clients', '#/clients', 'users'], ['Citation check', '#/check', 'shield'], ['Settings', '#/settings', 'gear'],
];
function openPalette() {
  if ($('.palette')) return;
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="palette"><input placeholder="Type a matter, client, case number, judgment or question…" aria-label="Search"><div class="pl"></div></div>`;
  document.body.appendChild(ov);
  const inp = $('input', ov), pl = $('.pl', ov);
  let items = [], sel = 0;
  const close = () => ov.remove();
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  const draw = groups => {
    items = []; let h = '';
    for (const [g, arr] of groups) {
      if (!arr.length) continue;
      h += `<div class="grp">${g}</div>`;
      for (const it of arr) { h += `<div class="it" data-i="${items.length}">${I(it.icon)}<span>${esc(it.label)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</div>`; items.push(it); }
    }
    pl.innerHTML = h || '<div class="empty small">No matches</div>'; sel = Math.min(sel, items.length - 1); mark();
    $$('.it', pl).forEach(el => { el.onmouseenter = () => { sel = +el.dataset.i; mark(); }; el.onclick = () => run(items[+el.dataset.i]); });
  };
  const mark = () => $$('.it', pl).forEach((el, i) => el.classList.toggle('on', i === sel));
  const run = it => { close(); if (it.go) location.hash = it.go; else if (it.fn) it.fn(); };
  const base = q => {
    const nav = PALETTE_STATIC.filter(([l]) => !q || l.toLowerCase().includes(q.toLowerCase())).map(([label, go, icon]) => ({ label, go, icon }));
    const acts = [{ label: 'New matter', icon: 'plus', fn: newMatter }, { label: 'New draft', icon: 'pen', fn: () => newDraft() }]
      .filter(a => !q || a.label.toLowerCase().includes(q.toLowerCase()));
    const ask = q.length > 2 ? [{ label: `Ask AI: “${q}”`, icon: 'spark', go: `#/research?mode=ask&q=${enc(q)}` }, { label: `Search judgments for “${q}”`, icon: 'search', go: `#/research?q=${enc(q)}` }] : [];
    return [['Research', ask], ['Go to', nav], ['Actions', acts]];
  };
  const live = debounce(async q => {
    if (q.length < 2) return;
    try {
      const r = await api('/search?q=' + enc(q));
      if (inp.value.trim() !== q) return;
      draw([['Research', base(q)[0][1]],
        ['Matters', r.matters.map(m => ({ label: m.title, sub: m.sub, icon: 'brief', go: '#/m/' + m.id }))],
        ['Judgments', r.judgments.map(j => ({ label: j.title, sub: j.sub, icon: 'book', go: '#/j/' + enc(j.id) }))],
        ['Drafts', r.drafts.map(d => ({ label: d.title, icon: 'pen', go: '#/d/' + d.id }))],
        ...base(q).slice(1)]);
    } catch { /* ignore */ }
  }, 180);
  inp.oninput = () => { const q = inp.value.trim(); sel = 0; draw(base(q)); live(q); };
  inp.onkeydown = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) run(items[sel]);
  };
  draw(base('')); inp.focus();
}
$('#omni').onclick = openPalette;
$('#omni').onkeydown = e => { if (e.key === 'Enter') openPalette(); };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('.overlay')) { e.preventDefault(); openPalette(); }
});

/* ================================================================ shared bits */
const empty = (icon, title, text, action = '') => `<div class="empty"><div class="ico">${I(icon)}</div><b>${title}</b><div>${text}</div>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
const skel = (n = 4) => `<div class="card pad">${Array.from({ length: n }, (_, i) => `<div class="skel" style="width:${90 - i * 12}%"></div>`).join('')}</div>`;
const snippet = s => esc(s).replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
const stagePill = id => id ? `<span class="pill brass">${esc(stageName(id) || id)}</span>` : '<span class="pill neutral">Stage not set</span>';
const TREAT = { negative: ['bad', 'Possible negative treatment'], caution: ['warn', 'Distinguished / doubted'], positive: ['ok', 'Followed'], cited: ['neutral', 'Cited'] };
function treatPill(t, short) {
  if (!t || t === 'none') return '';
  if (typeof t === 'object') t = t.negative ? 'negative' : t.caution ? 'caution' : t.positive ? 'positive' : t.cited ? 'cited' : '';
  if (!t) return '';
  const [cls, label] = TREAT[t];
  return `<span class="pill ${cls}" title="How later judgments in your library treat this case">${short && t === 'negative' ? '⚠ ' : ''}${label}</span>`;
}
const statusPill = s => `<span class="pill ${s === 'active' ? 'ok' : s === 'closed' ? 'neutral' : 'warn'}">${esc(s === 'on_hold' ? 'On hold' : s[0].toUpperCase() + s.slice(1))}</span>`;
function matterOptions(sel, none = 'No matter') {
  return `<option value="">${none}</option>` + S.matters.map(m => `<option value="${m.id}" ${+sel === m.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('');
}
function stageProgress(stage) {
  const ids = (S.playbook?.stages || []).map(s => s.id); const i = ids.indexOf(stage);
  return i < 0 ? 0 : Math.round((i + 1) / ids.length * 100);
}

/* ================================================================ router */
let currentNav = 'dash';
const routes = [
  [/^\/?$/, 'dash', viewDashboard], [/^\/research$/, 'research', viewResearch], [/^\/j\/(.+)$/, 'research', viewJudgment],
  [/^\/saved$/, 'saved', viewSaved], [/^\/matters$/, 'matters', viewMatters], [/^\/m\/(\d+)(?:\/(\w+))?$/, 'matters', viewMatter],
  [/^\/calendar$/, 'calendar', viewCalendar], [/^\/approvals$/, 'approvals', viewApprovals], [/^\/drafts$/, 'drafts', viewDrafts],
  [/^\/d\/(\d+)$/, 'drafts', viewDraft], [/^\/clients$/, 'clients', viewClients], [/^\/check$/, 'check', viewCheck], [/^\/settings(?:\/(\w+))?$/, 'settings', (...a) => viewSettings(...a)],
];
let leaveGuard = null;
async function route() {
  if (leaveGuard && !leaveGuard()) return;
  leaveGuard = null;
  const raw = location.hash.replace(/^#/, '') || '/';
  if (raw.startsWith('/accept') || !S.me) return start();
  const [path, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const [re, nav, fn] of routes) {
    const m = path.match(re);
    if (m) {
      currentNav = nav; renderNav(nav);
      $('#view').innerHTML = skel(6);
      window.scrollTo(0, 0);
      try { await fn(params, ...m.slice(1).map(x => x && decodeURIComponent(x))); } catch (e) { fail(e); $('#view').innerHTML = empty('alert', 'Something went wrong', esc(e.message)); }
      return;
    }
  }
  $('#view').innerHTML = empty('alert', 'Page not found', '<a href="#/">Back to dashboard</a>');
}
window.addEventListener('hashchange', route);
const setQS = (path, p) => { const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null)).toString(); history.replaceState(null, '', '#' + path + (q ? '?' + q : '')); };

/* ================================================================ dashboard */
async function viewDashboard() {
  const [d] = await Promise.all([api('/dashboard'), loadMatters(), loadPlaybook()]);
  S.counts = d.counts; renderNav('dash');
  const c = d.counts, maxStage = Math.max(1, ...d.stages.map(s => s.count));
  const kpi = (lbl, val, hint, href, cls = '') => `<div class="card kpi ${cls}" onclick="location.hash='${href}'"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="hint">${hint}</div></div>`;
  const dl = d.deadlines.filter(x => x.days_left >= -30);
  $('#view').innerHTML = `
  <div class="page-head"><div><div class="eyebrow">${fmt(d.date)} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}</div><h1 class="page">${greet()}, ${esc((S.me?.user?.name || "Advocate").split(" ").slice(0, 3).join(" "))}.</h1>
    <div class="sub">${c.hearings_today ? `${c.hearings_today} matter${c.hearings_today > 1 ? 's' : ''} listed today` : 'Nothing listed today'} · ${c.deadlines_week} deadline${c.deadlines_week === 1 ? '' : 's'} this week · ${c.pending_approvals} awaiting your approval</div></div>
    <div class="actions"><button class="btn" onclick="location.hash='#/calendar'">${I('cal')}Calendar</button><button class="btn brass" onclick="newDraft()">${I('pen')}New draft</button></div></div>
  <div class="kpis">
    ${kpi('Listed today', c.hearings_today, `${c.hearings_week} this week`, '#/calendar', 'accent')}
    ${kpi('Deadlines · 7 days', c.deadlines_week, c.overdue ? `${c.overdue} overdue` : 'none overdue', '#/calendar', c.overdue ? 'alert' : '')}
    ${kpi('Awaiting approval', c.pending_approvals, 'AI-proposed actions', '#/approvals')}
    ${kpi('Active matters', c.active_matters, `${c.open_tasks} open tasks`, '#/matters')}
    ${kpi('Research library', c.saved_judgments, `${c.drafts} drafts`, '#/saved')}
  </div>
  <div class="grid g-main">
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Cause list — next 7 days</h3><div class="r"><a href="#/calendar" class="small">Open calendar →</a></div></div>
        <div class="list">${d.hearings.length ? d.hearings.map(h => { const dt = parseISO(h.date); return `<div class="li"><div class="when"><div class="m">${MONTHS[dt.getMonth()]}</div><div class="d">${dt.getDate()}</div></div>
          <div class="body"><div class="row"><a class="ttl" href="#/m/${h.matter_id}">${esc(h.title)}</a>${daysTo(h.date) === 0 ? '<span class="pill warn">Today</span>' : `<span class="pill neutral">${relDay(h.date)}</span>`}</div>
          <div class="meta">${esc([h.court, h.case_number, h.stage].filter(Boolean).join(' · '))}</div>
          ${h.prepare.length ? `<ul class="check">${h.prepare.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></div>`; }).join('') : empty('cal', 'No hearings this week', 'Set a next date on a matter to see it here.')}</div></div>
      <div class="card"><div class="card-h"><h3>Limitation & statutory deadlines</h3><div class="r"><span class="small muted">Computed by fixed rules · confirm before relying</span></div></div>
        ${dl.length ? `<table class="tbl"><tr><th>Deadline</th><th>Matter</th><th>Due</th><th></th></tr>${dl.map(x => `<tr class="click" onclick="location.hash='#/m/${x.matter_id}'"><td><div class="title" style="font-weight:500">${esc(x.label)}</div><div>${esc(x.authority)}</div></td><td class="small">${esc(x.matter)}</td><td class="nowrap">${fmt(x.due_date)}</td><td>${dayPill(x.due_date)}</td></tr>`).join('')}</table>` : empty('clock', 'No deadlines in the next three weeks', 'Enter confirmed dates on a matter to compute them.')}</div>
    </div>
    <div class="stack">
      <div class="card pad"><h3 class="t">Research</h3>
        <form class="search-hero" onsubmit="event.preventDefault();location.hash='#/research?mode=ask&q='+encodeURIComponent(this.q.value)">${I('spark')}<input name="q" placeholder="Ask a legal question…"><button class="btn primary sm">Ask</button></form>
        ${d.recent_searches.length ? `<div class="small muted" style="margin:14px 0 8px">Recent</div><div class="chips">${d.recent_searches.map(q => `<span class="chip" onclick="location.hash='#/research?q=${enc(q)}'">${esc(q)}</span>`).join('')}</div>` : ''}
        <div class="divider"></div>
        <div class="row small"><span class="dot ${d.corpus.real_judgments ? 'on' : 'off'}"></span><span>${d.corpus.real_judgments ? `<b>${Number(d.corpus.real_judgments).toLocaleString('en-IN')}</b> judgments · ${Number(d.corpus.paragraphs).toLocaleString('en-IN')} paragraphs · ${d.corpus.year_min}–${d.corpus.year_max}` : 'Demo judgments only — <a href="#/settings">load real data</a>'}</span></div></div>
      <div class="card pad"><h3 class="t">Matters by stage</h3><div class="bars">${d.stages.map(s => `<div class="bar"><span>${esc(s.stage)}</span><span class="n">${s.count}</span><div class="track"><i style="width:${s.count / maxStage * 100}%"></i></div></div>`).join('') || '<div class="muted small">No active matters</div>'}</div></div>
      <div class="card pad"><h3 class="t">Recent activity</h3><div class="feed">${d.activity.map(a => `<div class="ev"><span class="b"></span><div><b>${esc(a.actor === 'system' ? 'Nyaay' : 'You')}</b> ${esc(a.text)} ${a.matter_id ? `<a href="#/m/${a.matter_id}">${esc(a.matter || '')}</a>` : ''}</div><span class="tm">${ago(a.at)}</span></div>`).join('') || '<div class="muted small">No activity yet</div>'}</div></div>
    </div>
  </div>`;
}

/* ================================================================ research */
const SUGGEST = ['Is the presumption under section 139 NI Act rebuttable?', 'Interim compensation under section 143A', 'Territorial jurisdiction for cheque dishonour complaints', 'Liability of directors under section 141', 'Condonation of delay in filing a section 138 complaint'];
let R = {};
async function viewResearch(p) {
  const st = await api('/research/stats');
  R = { q: p.q || '', mode: p.mode || 'search', court: p.court || '', yf: p.yf || '', yt: p.yt || '', offset: 0 };
  const ai = st.llm !== 'none';
  $('#view').innerHTML = `
  <div class="page-head"><div><div class="eyebrow">Research</div><h1 class="page">Search the law</h1>
    <div class="sub">${st.real_judgments ? `${Number(st.real_judgments).toLocaleString('en-IN')} judgments · ${Number(st.paragraphs).toLocaleString('en-IN')} paragraphs · ${st.year_min}–${st.year_max}` : 'Demo corpus (3 fictional judgments). Load real judgments in Data & settings.'}</div></div></div>
  <div class="card pad">
    <div class="row" style="margin-bottom:12px"><div class="seg" id="mode"><button data-m="search">${I('search')}Search judgments</button><button data-m="ask">${I('spark')}Ask AI</button></div>
      <span class="small muted">${R.mode === 'ask' && !ai ? 'AI not connected: shows the most relevant paragraphs' : 'Tip: use "quotes" for an exact phrase'}</span></div>
    <form class="search-hero" id="rf">${I('search')}<input id="rq" value="${esc(R.q)}" autocomplete="off"><button class="btn primary">Go</button></form>
    <div class="filters"><select class="input" id="rc"><option value="">All courts</option>${st.courts.map(c => `<option ${c.court === R.court ? 'selected' : ''}>${esc(c.court)}</option>`).join('')}</select>
      <input class="input" id="ryf" type="number" placeholder="From year" value="${esc(R.yf)}"><input class="input" id="ryt" type="number" placeholder="To year" value="${esc(R.yt)}">
      <button class="btn ghost" type="button" onclick="['rc','ryf','ryt'].forEach(i=>document.getElementById(i).value='');runResearch()">Clear</button></div>
  </div>
  <div id="rres" style="margin-top:18px"></div>`;
  const setMode = m => { R.mode = m; $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); $('#rq').placeholder = m === 'ask' ? 'Ask a question, e.g. "Can a cheque given as security attract section 138?"' : 'Search words, phrases, citations, party names…'; };
  $$('#mode button').forEach(b => b.onclick = () => { setMode(b.dataset.m); if ($('#rq').value.trim()) runResearch(); });
  setMode(R.mode);
  $('#rf').onsubmit = e => { e.preventDefault(); runResearch(); };
  ['rc', 'ryf', 'ryt'].forEach(i => $('#' + i).onchange = () => { if ($('#rq').value.trim()) runResearch(); });
  if (R.q) runResearch(); else { $('#rres').innerHTML = `<div class="card pad"><h3 class="t">Try</h3><div class="chips">${SUGGEST.map(s => `<span class="chip" onclick="document.getElementById('rq').value=this.textContent;runResearch()">${esc(s)}</span>`).join('')}</div></div>`; $('#rq').focus(); }
}
async function runResearch(more) {
  Object.assign(R, { q: $('#rq').value.trim(), court: $('#rc').value, yf: $('#ryf').value, yt: $('#ryt').value });
  if (R.q.length < 2) return;
  setQS('/research', { q: R.q, mode: R.mode === 'ask' ? 'ask' : '', court: R.court, yf: R.yf, yt: R.yt });
  const out = $('#rres');
  if (R.mode === 'ask') {
    out.innerHTML = `<div class="card pad"><span class="spin"></span> <span class="muted">Reading the most relevant paragraphs${S.health?.llm !== 'none' ? ' and drafting a cited answer' : ''}…</span>${skel(3).replace('card pad', '')}</div>`;
    const r = await api('/research/ask', { json: { question: R.q, court: R.court || null, year_from: R.yf ? +R.yf : null, year_to: R.yt ? +R.yt : null } });
    out.innerHTML = answerHtml(r, R.q);
    return;
  }
  if (!more) { R.offset = 0; out.innerHTML = skel(5); }
  const p = new URLSearchParams({ q: R.q, limit: 10, offset: R.offset });
  if (R.court) p.set('court', R.court); if (R.yf) p.set('year_from', R.yf); if (R.yt) p.set('year_to', R.yt);
  const r = await api('/research/search?' + p);
  const rows = r.results.map(x => `<div class="res"><div class="h"><div class="grow"><div class="ttl" onclick="location.hash='#/j/${enc(x.id)}?hl=${enc(R.q)}'">${esc(x.title)}</div>
    <div class="meta">${x.citation ? `<span class="cite">${esc(x.citation)}</span>` : ''}<span>${esc(x.court)}</span><span>·</span><span>${fmt(x.decision_date)}</span>${treatPill(x.treatment, true)}</div></div>
    <button class="btn ghost sm" title="Save" onclick="saveAuthority('${esc(x.id)}')">${I('bookmark')}</button></div>
    ${x.hits.map(h => `<div class="snip"><span class="pn">¶ ${h.no || '—'}</span>${snippet(h.snippet)}</div>`).join('')}
    <a class="small" href="#/j/${enc(x.id)}?p=${x.hits[0]?.no ?? ''}&hl=${enc(R.q)}">Open at paragraph ${x.hits[0]?.no ?? ''} →</a></div>`).join('');
  if (!more) out.innerHTML = `<div class="row" style="margin:0 2px 10px"><span class="muted small"><b>${r.total}</b> judgment${r.total === 1 ? '' : 's'}${r.match === 'or' && r.total ? ' · no judgment contains every word, showing closest matches' : r.match === 'hybrid' ? ' · keyword + meaning' : r.match === 'semantic' ? ' · matched by meaning' : ''}</span>${thumbs('search', R.q)}
      <button class="btn sm" style="margin-left:auto" onclick="R.mode='ask';document.querySelector('#mode [data-m=ask]').click()">${I('spark')}Ask AI instead</button></div>
    <div class="card" id="rlist">${rows || empty('search', 'No judgments found', 'Try fewer words, a synonym, or remove filters.')}</div><div id="rmore" style="text-align:center;margin-top:14px"></div>`;
  else $('#rlist').insertAdjacentHTML('beforeend', rows);
  R.offset += r.results.length;
  $('#rmore').innerHTML = R.offset < r.total ? `<button class="btn" onclick="runResearch(true)">Load more (${r.total - R.offset} more)</button>` : '';
}
function answerHtml(r, q, compact) {
  let h = '';
  if (r.answer) {
    const c = r.checks || { invalid_markers_removed: [], uncited_sentences: [], cited_sources: [] };
    const body = r.answer.split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\[S(\d+)\]/g, (m, n) => `<sup class="ref" onclick="flashSrc(${n})">${n}</sup>`)}</p>`).join('');
    h += `<div class="card pad"><div class="row" style="margin-bottom:10px"><span class="eyebrow">Answer</span><span class="pill ${r.confidence === 'high' ? 'ok' : r.confidence === 'medium' ? 'info' : 'warn'}">${esc(r.confidence)} confidence</span>
        ${r.cached ? '<span class="pill neutral" title="Same question asked recently — no AI cost">cached</span>' : ''}
        <span style="margin-left:auto">${thumbs('answer', q)}</span><button class="btn ghost sm" onclick="copy(${esc(JSON.stringify(r.answer.replace(/\[S(\d+)\]/g, '[$1]')))},'Answer copied')">${I('copy')}Copy</button></div>
      <div class="answer">${body}</div>${r.limitations ? `<div class="small muted">${esc(r.limitations)}</div>` : ''}
      <div class="trust"><span class="pill ok">${I('check')} ${c.cited_sources.length} source${c.cited_sources.length === 1 ? '' : 's'} cited · all checked against the database</span>
        ${c.invalid_markers_removed.length ? `<span class="pill bad">${c.invalid_markers_removed.length} invalid reference(s) removed</span>` : ''}
        ${c.uncited_sentences.length ? `<span class="pill warn">${c.uncited_sentences.length} statement(s) without a source — treat as unverified</span>` : ''}
        ${(r.sources || []).some(s => s.treatment === 'negative') ? '<span class="pill bad">⚠ A source may have been overruled — check “Cited by” in the reader</span>' : ''}
        <span class="pill neutral">Read each paragraph before relying on it</span></div></div>`;
  } else h += `<div class="card pad row" style="flex-wrap:nowrap">${I('alert', 'muted')}<span class="muted grow">${esc(r.message || 'No answer')}</span></div>`;
  if (r.sources?.length) h += `<div class="card" style="margin-top:16px"><div class="card-h"><h3>Sources</h3><div class="r small muted">${r.sources.length} paragraphs retrieved</div></div>
    ${r.sources.map(s => `<div class="src" id="src${s.sid}"><div class="n">${s.sid}</div><div class="grow"><a href="#/j/${enc(s.jid)}?p=${s.para_no}${q ? '&hl=' + enc(q) : ''}" class="serif" style="font-size:17px;font-weight:600;color:var(--ink)">${esc(s.title)}</a>
      <div class="meta small muted" style="margin:2px 0 6px">${s.citation ? `<span class="cite">${esc(s.citation)}</span> · ` : ''}${esc(s.court)} · ${fmt(s.decision_date)} · ¶ ${s.para_no} ${treatPill(s.treatment, true)}</div>
      <div class="snip" style="margin:0">${esc(compact ? s.text.slice(0, 420) + (s.text.length > 420 ? '…' : '') : s.text)}</div></div>
      <div><button class="btn ghost sm" title="Save paragraph" onclick="saveAuthority('${esc(s.jid)}',${s.para_no})">${I('bookmark')}</button></div></div>`).join('')}</div>`;
  return h;
}
function flashSrc(n) { const el = $('#src' + n); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

async function saveAuthority(jid, para) {
  await loadMatters();
  modal('Save authority', `<div class="field"><label class="f">Save to matter</label><select class="input" id="bm_m">${matterOptions('', 'Library only (no matter)')}</select></div>
    <div class="field"><label class="f">Note (why it matters)</label><textarea class="input" id="bm_n" style="min-height:80px" placeholder="e.g. Burden on accused once signature admitted"></textarea></div>
    ${para != null ? `<div class="small muted">Paragraph ${para} will be saved with its text.</div>` : ''}`,
  { okText: 'Save', ok: async ov => { await api('/bookmarks', { json: { jid, para_no: para ?? null, matter_id: $('#bm_m', ov).value ? +$('#bm_m', ov).value : null, note: $('#bm_n', ov).value } }); toast('Saved to authorities'); refreshCounts(); } });
}

/* ================================================================ judgment reader */
async function viewJudgment(p, id) {
  const [j, l] = await Promise.all([api('/judgments/' + enc(id)), api('/judgments/' + enc(id) + '/links')]);
  const hl = (p.hl || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const terms = [...new Set(hl.filter(t => !['the', 'and', 'for', 'under', 'with', 'that', 'this', 'section', 'whether'].includes(t)))];
  const hiText = t => { let s = esc(t); if (!terms.length) return s; const re = new RegExp('\\b(' + terms.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi'); return s.replace(re, '<mark>$1</mark>'); };
  const cite = (j.citations || [])[0] || '';
  const ref = `${j.title}${cite ? ', ' + cite : ''} (${j.court}, ${fmt(j.decision_date)})`;
  const lk = (arr, t) => `<div class="card pad"><h3 class="t">${t} <span class="faint">(${arr.length})</span></h3>${arr.length ? arr.slice(0, 40).map(x => `<div class="linkrow"><a href="#/j/${enc(x.id)}${x.paras && x.paras.length ? '?p=' + x.paras[0] : ''}">${esc(x.title)}</a><div class="small faint row" style="gap:6px">${esc(x.court)} · ${esc(x.year)}${x.paras && x.paras.length ? ' · ¶ ' + x.paras.slice(0, 3).join(', ') : ''} ${x.treatment ? treatPill(x.treatment) : ''}</div></div>`).join('') : '<div class="small muted">None in the loaded library.</div>'}</div>`;
  const neg = l.cited_by.filter(x => x.treatment === 'negative');
  const size = store.get('readSize', 17);
  $('#view').innerHTML = `
  <div class="row" style="margin-bottom:14px"><button class="btn ghost sm" onclick="history.back()">${I('back')}Back</button></div>
  <div class="grid g-read">
   <div class="card" style="overflow:visible">
    <div class="reader-head"><div class="eyebrow">${esc(j.court)}${j.source === 'fixture' ? ' · Fictional test judgment' : ''}</div><h1>${esc(j.title)}</h1>
      <div class="row small muted">${(j.citations || []).map(c => `<span class="cite">${esc(c)}</span>`).join(' ')}<span>Decided ${fmt(j.decision_date)}</span>${j.bench ? `<span>· ${esc(j.bench)}</span>` : ''}${j.disposal ? `<span class="pill neutral">${esc(j.disposal)}</span>` : ''}</div></div>
    <div class="reader-tools">
      <div class="search-hero" style="padding:2px 4px 2px 10px;flex:1;min-width:200px;box-shadow:none;border-radius:8px">${I('search')}<input id="jfind" placeholder="Find in judgment" style="height:32px;font-size:14px"></div>
      <button class="btn sm" onclick="summ('${esc(j.id)}')">${I('spark')}Summary</button>
      <button class="btn sm" onclick="saveAuthority('${esc(j.id)}')">${I('bookmark')}Save</button>
      <button class="btn sm" onclick="copy(${esc(JSON.stringify(ref))},'Reference copied')">${I('copy')}Cite</button>
      ${j.source_url ? `<a class="btn sm" href="${esc(j.source_url)}" target="_blank" rel="noopener">${I('download')}PDF</a>` : ''}
      <div class="seg"><button onclick="readSize(-1)">A−</button><button onclick="readSize(1)">A+</button></div>
      <button class="btn ghost sm" onclick="window.print()" title="Print">${I('print')}</button>
    </div>
    ${neg.length ? `<div class="card-b" style="background:var(--bad-soft);color:var(--bad);border-bottom:1px solid var(--line)"><b>⚠ Possible negative treatment.</b> ${neg.length} later judgment(s) in your library use words like “overruled” or “not good law” near a citation to this case: ${neg.slice(0, 3).map(x => `<a style="color:inherit;text-decoration:underline" href="#/j/${enc(x.id)}${x.paras[0] != null ? '?p=' + x.paras[0] : ''}">${esc(x.title)}</a>`).join(', ')}. Read those paragraphs before relying on it.</div>` : ''}
    <div id="jsum"></div>
    <div class="reader-body" id="jbody" style="--read-size:${size}px">${j.paragraphs.map(pa => `<div class="para ${pa.no === 0 ? 'header' : ''}" id="p${pa.no}" data-t="${esc(pa.text.toLowerCase())}">
      <div class="no" title="Copy paragraph" onclick="copyPara('${esc(j.id)}',${pa.no})">${pa.no ? pa.no : ''}</div><div class="tx">${hiText(pa.text)}</div>
      <div class="acts"><button class="btn sm" onclick="copyPara('${esc(j.id)}',${pa.no})" title="Copy with citation">${I('copy')}</button><button class="btn sm" onclick="saveAuthority('${esc(j.id)}',${pa.no})" title="Save paragraph">${I('bookmark')}</button></div></div>`).join('')}</div>
   </div>
   <div class="rail">
    <div class="card pad"><h3 class="t">Ask this judgment</h3><form onsubmit="event.preventDefault();askJ('${esc(j.id)}')"><textarea class="input" id="jq" style="min-height:70px" placeholder="e.g. What did the court hold on the burden of proof?"></textarea><button class="btn primary" style="margin-top:8px;width:100%;justify-content:center">${I('spark')}Ask</button></form><div id="jans"></div></div>
    ${lk(l.cited_by, 'Cited by')}${lk(l.cites, 'Relies on')}
    <div class="small faint" style="padding:0 4px">${l.citations_in_text} citation(s) in the text, ${l.not_in_corpus} not in the loaded database.</div>
   </div>
  </div>`;
  window._jdoc = j;
  $('#jfind').oninput = debounce(e => {
    const q = e.target.value.trim().toLowerCase();
    $$('.para', $('#jbody')).forEach(el => { const hit = q.length > 2 && el.dataset.t.includes(q); el.classList.toggle('hit', hit); el.classList.toggle('dim', q.length > 2 && !hit); });
    const first = $('.para.hit'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
  const target = p.p ? $('#p' + p.p) : (terms.length ? $('.para mark')?.closest('.para') : null);
  if (target) setTimeout(() => { target.classList.add('hit'); target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120);
}
function readSize(d) { const s = Math.min(22, Math.max(14, store.get('readSize', 17) + d)); store.set('readSize', s); $('#jbody').style.setProperty('--read-size', s + 'px'); }
function copyPara(jid, no) {
  const j = window._jdoc; const pa = j.paragraphs.find(x => x.no === no); if (!pa) return;
  copy(`“${pa.text}”\n— ${j.title}${j.citations?.[0] ? ', ' + j.citations[0] : ''}, para ${no} (${j.court}, ${fmt(j.decision_date)})`, `Paragraph ${no} copied with citation`);
}
async function summ(id) {
  $('#jsum').innerHTML = `<div class="card-b"><span class="spin"></span> <span class="muted">Summarising…</span></div>`;
  const r = await api(`/judgments/${enc(id)}/summary`, { json: {} });
  $('#jsum').innerHTML = r.held ? `<div class="card-b" style="background:var(--brass-soft);border-bottom:1px solid var(--line)"><div class="eyebrow">Headnote (AI)</div>
    <div class="grid g2" style="margin-top:10px"><div><b class="small">Issues</b><ul style="margin:6px 0 0;padding-left:18px">${r.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>
    <div><b class="small">Held</b><p style="margin:6px 0">${esc(r.held)}</p><b class="small">Disposition</b><p style="margin:6px 0">${esc(r.disposition)}</p></div></div>
    ${r.key_paragraphs?.length ? `<div class="small">Key paragraphs: ${r.key_paragraphs.map(n => `<a href="javascript:void(0)" onclick="document.getElementById('p${n}').scrollIntoView({behavior:'smooth',block:'center'})">¶${n}</a>`).join(', ')}</div>` : ''}
    <div class="flag">${I('alert')}${esc(r.basis || 'AI generated. Read the judgment before relying on it.')}</div></div>`
    : `<div class="card-b muted small">${esc(r.message || 'No summary available')}</div>`;
}
async function askJ(id) {
  const q = $('#jq').value.trim(); if (q.length < 5) return toast('Ask a full question', true);
  $('#jans').innerHTML = '<div style="margin-top:10px"><span class="spin"></span></div>';
  const r = await api('/research/ask', { json: { question: q, jid: id } });
  $('#jans').innerHTML = `<div style="margin-top:12px">${r.answer ? `<div class="answer" style="font-size:15px">${esc(r.answer).replace(/\[S(\d+)\]/g, (m, n) => { const s = r.sources[n - 1]; return s ? `<sup class="ref" onclick="document.getElementById('p${s.para_no}').scrollIntoView({behavior:'smooth',block:'center'})">¶${s.para_no}</sup>` : ''; })}</div>`
    : `<div class="small muted">${esc(r.message || '')}</div>${(r.sources || []).slice(0, 4).map(s => `<div class="linkrow"><a href="javascript:void(0)" onclick="document.getElementById('p${s.para_no}').scrollIntoView({behavior:'smooth',block:'center'})">¶ ${s.para_no}</a> <span class="small muted">${esc(s.text.slice(0, 140))}…</span></div>`).join('')}`}</div>`;
}

/* ================================================================ saved authorities */
async function viewSaved() {
  const [b] = await Promise.all([api('/bookmarks'), loadMatters()]);
  const groups = {};
  b.forEach(x => (groups[x.matter_id || 0] = groups[x.matter_id || 0] || []).push(x));
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Research</div><h1 class="page">Saved authorities</h1><div class="sub">${b.length} saved · organised by matter</div></div>
    <div class="actions"><button class="btn" onclick="location.hash='#/research'">${I('search')}Find authorities</button></div></div>
  ${b.length ? Object.entries(groups).sort((a, c) => (+a[0] === 0) - (+c[0] === 0)).map(([mid, arr]) => `<div class="card" style="margin-bottom:16px"><div class="card-h">${I('brief')}<h3>${+mid ? `<a href="#/m/${mid}">${esc(matterTitle(+mid))}</a>` : 'General library'}</h3><div class="r small muted">${arr.length}</div></div>
    ${arr.map(x => `<div class="res"><div class="h"><div class="grow"><a class="ttl" href="#/j/${enc(x.jid)}${x.para_no != null ? '?p=' + x.para_no : ''}">${esc(x.title)}</a>
      <div class="meta">${x.citation ? `<span class="cite">${esc(x.citation)}</span>` : ''}${x.para_no != null ? `<span class="pill brass">¶ ${x.para_no}</span>` : ''}<span class="faint">saved ${ago(x.created_at)}</span></div></div>
      <button class="btn ghost sm" onclick="editBm(${x.id},${esc(JSON.stringify(x.note))},${x.matter_id || 'null'})">${I('pen')}</button><button class="btn ghost sm" onclick="delBm(${x.id})">${I('trash')}</button></div>
      ${x.excerpt ? `<div class="snip">${esc(x.excerpt.slice(0, 600))}${x.excerpt.length > 600 ? '…' : ''}</div>` : ''}${x.note ? `<div class="note" style="margin:8px 0 0">${esc(x.note)}</div>` : ''}</div>`).join('')}</div>`).join('')
  : `<div class="card">${empty('bookmark', 'No saved authorities yet', 'Save a judgment or a single paragraph from search results or the reader.', '<a class="btn primary" href="#/research">Start researching</a>')}</div>`}`;
}
function editBm(id, note, mid) {
  modal('Edit saved authority', `<div class="field"><label class="f">Matter</label><select class="input" id="e_m">${matterOptions(mid, 'Library only')}</select></div><div class="field"><label class="f">Note</label><textarea class="input" id="e_n">${esc(note)}</textarea></div>`,
    { ok: async ov => { await api('/bookmarks/' + id, { method: 'PATCH', json: { note: $('#e_n', ov).value, matter_id: $('#e_m', ov).value ? +$('#e_m', ov).value : null } }); toast('Updated'); route(); } });
}
async function delBm(id) { await api('/bookmarks/' + id, { method: 'DELETE' }); toast('Removed'); route(); }

/* ================================================================ matters */
async function viewMatters(p) {
  await Promise.all([loadMatters(), loadPlaybook()]);
  const F = { q: p.q || '', status: p.status || 'active', stage: p.stage || '' };
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Practice</div><h1 class="page">Matters</h1><div class="sub">${S.matters.filter(m => m.status === 'active').length} active · ${S.matters.length} total</div></div>
    <div class="actions"><button class="btn primary" onclick="newMatter()">${I('plus')}New matter</button></div></div>
  <div class="card"><div class="card-h"><div class="search-hero" style="flex:1;padding:2px 4px 2px 12px;box-shadow:none;border-radius:8px;max-width:420px">${I('search')}<input id="mq" placeholder="Filter by title, client, court, case no." value="${esc(F.q)}" style="height:34px;font-size:14px"></div>
    <div class="r"><select class="input" id="mstage" style="width:220px"><option value="">All stages</option>${S.playbook.stages.map(s => `<option value="${s.id}" ${F.stage === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <div class="seg" id="mstat">${['active', 'on_hold', 'closed', 'all'].map(s => `<button data-s="${s}" class="${F.status === s ? 'on' : ''}">${s === 'on_hold' ? 'On hold' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div></div>
  <div id="mtable"></div></div>`;
  const draw = () => {
    const q = F.q.toLowerCase();
    const rows = S.matters.filter(m => (F.status === 'all' || m.status === F.status) && (!F.stage || m.current_stage === F.stage) &&
      (!q || [m.title, m.client_name, m.court, m.case_number, m.cnr].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (a.next_date || '9999') < (b.next_date || '9999') ? -1 : 1);
    setQS('/matters', { q: F.q, status: F.status === 'active' ? '' : F.status, stage: F.stage });
    $('#mtable').innerHTML = rows.length ? `<table class="tbl"><tr><th>Matter</th><th>Client</th><th>Stage</th><th>Progress</th><th>Next date</th><th>Status</th></tr>
      ${rows.map(m => `<tr class="click" onclick="location.hash='#/m/${m.id}'"><td><div class="title">${esc(m.title)}</div><div>${esc([m.court, m.case_number].filter(Boolean).join(' · ') || '—')}</div></td>
      <td class="small">${esc(m.client_name || '—')}</td><td>${stagePill(m.current_stage)}</td><td><div class="progress"><i style="width:${stageProgress(m.current_stage)}%"></i></div></td>
      <td class="nowrap">${m.next_date ? `${fmt(m.next_date)}<div class="small ${daysTo(m.next_date) < 0 ? 'muted' : ''}" style="color:${daysTo(m.next_date) === 0 ? 'var(--warn)' : ''}">${relDay(m.next_date)}</div>` : '<span class="faint">Not set</span>'}</td><td>${statusPill(m.status)}</td></tr>`).join('')}</table>`
      : empty('brief', 'No matters match', 'Change the filters or create a new matter.', `<button class="btn primary" onclick="newMatter()">${I('plus')}New matter</button>`);
  };
  $('#mq').oninput = debounce(e => { F.q = e.target.value.trim(); draw(); }, 120);
  $('#mstage').onchange = e => { F.stage = e.target.value; draw(); };
  $$('#mstat button').forEach(b => b.onclick = () => { F.status = b.dataset.s; $$('#mstat button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}
async function newMatter() {
  await loadPlaybook();
  modal('New matter', `<div class="field"><label class="f">Cause title *</label><input class="input" id="n_t" placeholder="Complainant v. Accused"></div>
    <div class="grid g2" style="gap:12px"><div class="field"><label class="f">Client</label><input class="input" id="n_c"></div><div class="field"><label class="f">Court</label><input class="input" id="n_co" placeholder="e.g. JMFC Court No. 4, Pune"></div>
    <div class="field"><label class="f">Case number</label><input class="input" id="n_cn"></div><div class="field"><label class="f">CNR</label><input class="input" id="n_cnr" placeholder="16-character eCourts CNR"></div>
    <div class="field"><label class="f">Current stage</label><select class="input" id="n_s"><option value="">Not set</option>${S.playbook.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="f">Next date</label><input class="input" type="date" id="n_nd"></div></div>
    <div class="field"><label class="f">Goal</label><input class="input" id="n_g" placeholder="e.g. Recover the cheque amount with compensation"></div>
    <div class="small muted">Case type: ${esc(S.playbook.name)} (playbook ${esc(S.playbook.status)}).</div>`,
  { okText: 'Create matter', ok: async ov => {
    const v = id => $('#' + id, ov).value.trim() || null;
    if (!v('n_t')) { toast('Enter a cause title', true); return false; }
    const m = await api('/matters', { json: { title: v('n_t'), client_name: v('n_c'), court: v('n_co'), case_number: v('n_cn'), cnr: v('n_cnr'), goal: v('n_g') } });
    if (v('n_s') || v('n_nd')) await api('/matters/' + m.id, { method: 'PATCH', json: { ...(v('n_s') ? { current_stage: v('n_s') } : {}), ...(v('n_nd') ? { next_date: v('n_nd') } : {}) } });
    toast('Matter created'); location.hash = '#/m/' + m.id; refreshCounts();
  } });
}

const MTABS = [['overview', 'Overview'], ['orders', 'Orders'], ['tasks', 'Tasks'], ['drafts', 'Drafts'], ['research', 'Authorities'], ['notes', 'Notes'], ['details', 'Parties & cheque']];
async function viewMatter(p, id, tab = 'overview') {
  id = +id;
  const [d, pb, notes, bms, drafts, tpl] = await Promise.all([api('/matters/' + id), loadPlaybook(), api(`/matters/${id}/notes`), api('/bookmarks?matter_id=' + id), api('/drafts?matter_id=' + id), loadTemplates(), loadMatters()]);
  const m = d.matter, plan = d.plan;
  const counts = { orders: d.orders.length, tasks: d.tasks.filter(t => t.status === 'proposed').length, drafts: drafts.length, research: bms.length, notes: notes.length };
  $('#view').innerHTML = `
  <div class="row" style="margin-bottom:10px"><a class="small" href="#/matters">${I('back', '').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"')} All matters</a></div>
  <div class="page-head" style="margin-bottom:16px"><div class="grow"><div class="eyebrow">${esc(m.court || 'Court not set')}${m.case_number ? ' · ' + esc(m.case_number) : ''}</div><h1 class="page">${esc(m.title)}</h1>
    <div class="row small muted" style="margin-top:4px">${statusPill(m.status)} ${stagePill(m.current_stage)} <span>Client: <b style="color:var(--ink)">${esc(m.client_name || '—')}</b></span><span>· Next date: <b style="color:var(--ink)">${m.next_date ? fmt(m.next_date) + ' (' + relDay(m.next_date) + ')' : 'not set'}</b></span></div></div>
    <div class="actions">${S.health?.integrations?.ecourts ? `<button class="btn" onclick="syncMatter(${m.id})" title="${esc(m.sync_status || 'Pull orders and next date from eCourts')}">${I('clock')}${m.synced_at ? 'Synced ' + ago(m.synced_at) : 'Sync eCourts'}</button>` : ''}<button class="btn" onclick="editMatter(${m.id})">${I('pen')}Edit</button><button class="btn" onclick="newDraft(${m.id})">${I('doc')}New draft</button><button class="btn primary" onclick="location.hash='#/m/${m.id}/orders'">${I('upload')}Add order</button></div></div>
  <div class="tabs">${MTABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" onclick="location.hash='#/m/${m.id}/${k}'">${l}${counts[k] ? `<span class="count">${counts[k]}</span>` : ''}</button>`).join('')}</div>
  <div id="mtab"></div>`;
  const T = $('#mtab');

  if (tab === 'overview') {
    const dl = d.deadlines;
    T.innerHTML = `<div class="card pad" style="margin-bottom:18px"><div class="row" style="margin-bottom:14px"><h3 class="t" style="margin:0">Where the case stands</h3><span class="small muted" style="margin-left:auto">${esc(pb.name)} · playbook ${esc(plan.playbook_status)}</span></div>
      <div class="stepper">${plan.stages.map(s => `<div class="step ${s.state}" title="${esc(s.name)}"><i></i>${esc(s.name)}</div>`).join('')}</div></div>
    <div class="grid g-main"><div class="stack">
      <div class="card pad"><h3 class="t">Do now${plan.current_stage_name ? ' — ' + esc(plan.current_stage_name) : ''}</h3><ul class="check">${plan.current_actions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        ${plan.next_stage ? `<div class="divider"></div><div class="small muted">Next stage: <b style="color:var(--ink)">${esc(plan.next_stage)}</b></div><ul class="check">${plan.next_stage_actions.slice(0, 3).map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${!m.current_stage ? `<div class="flag">${I('alert')}Set the current stage to get a plan.</div>` : ''}</div>
      <div class="card"><div class="card-h"><h3>Statutory deadlines</h3><div class="r small muted">Fixed rules · court-filing dates move past holidays you add</div></div>
        ${dl.length ? `<table class="tbl">${dl.map(x => `<tr><td><div style="font-weight:500">${esc(x.label)}</div><div class="small muted">${esc(x.authority)}</div></td><td class="nowrap">${x.due_date ? fmt(x.due_date) : `<span class="small faint">${esc(x.note)}</span>`}</td>
          <td>${x.met ? '<span class="pill ok">Stage passed</span>' : x.due_date ? dayPill(x.due_date) : '<span class="pill neutral">Needs date</span>'}${revPill(x.review)}</td></tr>${x.original_due_date ? `<tr><td colspan="3" class="small" style="color:var(--info);padding-top:0">${I('cal')} ${esc(x.note.split('. ')[0])}. Section 10, General Clauses Act.</td></tr>` : ''}`).join('')}</table>` : `<div class="card-b muted small">Enter the confirmed dates to compute deadlines.</div>`}</div>
    </div><div class="stack">
      <div class="card pad"><h3 class="t">Confirmed dates</h3><div class="small muted" style="margin-bottom:12px">From the cheque, return memo and postal proof. Deadlines are recalculated by rule, never by AI.</div>
        ${pb.inputs.map(i => `<div class="field"><label class="f">${esc(i.label)}</label><input class="input" type="date" id="f_${i.name}" value="${esc(m.facts[i.name] || '')}"></div>`).join('')}
        <button class="btn primary" onclick="saveFacts(${m.id})">Save dates</button></div>
      <div class="card pad"><h3 class="t">Matter</h3><dl class="kv"><dt>Court</dt><dd>${esc(m.court || '—')}</dd><dt>Case number</dt><dd>${esc(m.case_number || '—')}</dd><dt>CNR</dt><dd>${esc(m.cnr || '—')}</dd><dt>Client</dt><dd>${esc(m.client_name || '—')}</dd><dt>Goal</dt><dd>${esc(m.goal || '—')}</dd><dt>Opened</dt><dd>${fmt(m.created_at)}</dd></dl></div>
      ${notes[0] ? `<div class="card pad"><h3 class="t">Latest note</h3><div class="note" style="margin:0">${esc(notes[0].body)}</div><a class="small" href="#/m/${m.id}/notes">All notes →</a></div>` : ''}
    </div></div>`;
  }

  if (tab === 'orders') {
    T.innerHTML = `<div class="grid g-main"><div class="stack">${d.orders.length ? d.orders.map(o => `<div class="order"><div class="row"><b class="serif" style="font-size:18px">Order ${o.order_date ? 'dated ' + fmt(o.order_date) : ''}</b><span class="pill neutral">${esc(o.extraction_method)}</span>${o.detected_stage ? `<span class="pill brass">${esc(stageName(o.detected_stage) || o.detected_stage)}</span>` : ''}<span class="small muted" style="margin-left:auto">Next date: <b>${fmt(o.next_date)}</b></span></div>
      <div class="small faint">via ${esc(o.source === 'whatsapp' ? 'WhatsApp' : o.source === 'ecourts' ? 'eCourts sync' : 'upload')} · ${ago(o.created_at)}</div>
      <p style="margin:10px 0">${esc(o.summary)}</p>${o.directions.length ? `<div class="small"><b>Directions</b><ul style="margin:4px 0;padding-left:18px">${o.directions.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${o.needs_review.map(r => `<div class="flag">${I('alert')}${esc(r)}</div>`).join('')}
      ${o.client_message ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer;color:var(--navy)">Client message draft</summary><div class="note" style="margin-top:8px">${esc(o.client_message)}</div><button class="btn sm" onclick="copy(${esc(JSON.stringify(o.client_message))},'Message copied')">${I('copy')}Copy for WhatsApp</button></details>` : ''}</div>`).join('')
      : `<div class="card">${empty('doc', 'No orders yet', 'Paste or upload the latest order. Nyaay reads the next date and directions and proposes tasks for your approval.')}</div>`}</div>
      <div class="card pad" style="align-self:flex-start"><h3 class="t">Add a court order</h3>
        <div class="field"><label class="f">Paste order text</label><textarea class="input" id="ot" placeholder="Order dated 12.11.2026. Accused absent…" style="min-height:160px"></textarea></div>
        <div class="field"><label class="f">…or upload PDF / image / text</label><input class="input" type="file" id="of" style="padding:7px"></div>
        <div class="field"><label class="f">Client message language</label><select class="input" id="ol"><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></select></div>
        <button class="btn primary" style="width:100%;justify-content:center" id="obtn" onclick="addOrder(${m.id})">${I('spark')}Read order</button>
        <div class="hint-t">Nothing changes in the matter until you approve the proposed tasks.</div></div></div>`;
  }

  if (tab === 'tasks') {
    const grp = s => d.tasks.filter(t => t.status === s);
    const row = t => `<div class="task"><div class="grow"><div class="src-tag">${esc(t.source)}${t.due_date ? ' · due ' + fmt(t.due_date) : ''}</div><div style="font-weight:500">${esc(t.title)}</div>${t.detail && t.detail !== t.title ? `<div class="small muted" style="white-space:pre-wrap">${esc(t.detail.slice(0, 300))}</div>` : ''}</div>
      ${t.status === 'proposed' ? (canDecide() ? `<button class="btn ok sm" onclick="decide(${t.id},'approve')">${I('check')}Approve</button><button class="btn sm" onclick="decide(${t.id},'reject')">Reject</button>` : '<span class="pill warn">awaiting an advocate</span>') : t.status === 'approved' ? `<button class="btn sm" onclick="decide(${t.id},'done')">${I('check')}Mark done</button>` : `<span class="pill ${t.status === 'done' ? 'ok' : 'neutral'}">${esc(t.status)}</span>`}</div>`;
    T.innerHTML = `<div class="stack">${[['proposed', 'Awaiting approval'], ['approved', 'To do'], ['done', 'Done'], ['rejected', 'Rejected']].map(([s, l]) => grp(s).length ? `<div class="card"><div class="card-h"><h3>${l}</h3><div class="r small muted">${grp(s).length}</div></div>${grp(s).map(row).join('')}</div>` : '').join('') || `<div class="card">${empty('inbox', 'No tasks', 'Tasks appear when you add an order or Nyaay suggests next steps.')}</div>`}</div>`;
  }

  if (tab === 'drafts') {
    T.innerHTML = `<div class="card"><div class="card-h"><h3>Drafts for this matter</h3><div class="r"><button class="btn primary sm" onclick="newDraft(${m.id})">${I('plus')}New draft</button></div></div>
      ${drafts.length ? `<table class="tbl">${drafts.map(x => `<tr class="click" onclick="location.hash='#/d/${x.id}'"><td><div class="title">${esc(x.title)}</div><div>Updated ${ago(x.updated_at)}</div></td><td>${x.placeholders ? `<span class="pill warn">${x.placeholders} blanks</span>` : '<span class="pill ok">Complete</span>'}</td><td><span class="pill ${x.status === 'final' ? 'ok' : 'neutral'}">${esc(x.status)}</span></td></tr>`).join('')}</table>`
      : empty('pen', 'No drafts yet', 'Generate a notice, complaint or application pre-filled from this matter.', `<div class="chips" style="justify-content:center">${tpl.templates.map(t => `<span class="chip" onclick="createDraft('${t.id}',${m.id})">${esc(t.name)}</span>`).join('')}</div>`)}</div>`;
  }

  if (tab === 'research') {
    T.innerHTML = `<div class="card pad" style="margin-bottom:16px"><form class="search-hero" onsubmit="event.preventDefault();location.hash='#/research?q='+encodeURIComponent(this.q.value)">${I('search')}<input name="q" placeholder="Find authorities for this matter…"><button class="btn primary sm">Search</button></form></div>
      <div class="card">${bms.length ? bms.map(x => `<div class="res"><a class="ttl" href="#/j/${enc(x.jid)}${x.para_no != null ? '?p=' + x.para_no : ''}">${esc(x.title)}</a><div class="meta">${x.citation ? `<span class="cite">${esc(x.citation)}</span>` : ''}${x.para_no != null ? `<span class="pill brass">¶ ${x.para_no}</span>` : ''}</div>${x.excerpt ? `<div class="snip">${esc(x.excerpt.slice(0, 500))}</div>` : ''}${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}</div>`).join('')
      : empty('bookmark', 'No authorities saved to this matter', 'From search results or the reader, use Save and pick this matter.')}</div>`;
  }

  if (tab === 'notes') {
    T.innerHTML = `<div class="grid g-main"><div>${notes.map(n => `<div class="note"><div class="row small muted" style="margin-bottom:4px"><span>${esc(n.author)} · ${ago(n.created_at)}</span><button class="btn ghost sm" style="margin-left:auto" onclick="delNote(${n.id},${m.id})">${I('trash')}</button></div>${esc(n.body)}</div>`).join('') || `<div class="card">${empty('pen', 'No notes', 'Keep hearing notes, client instructions and strategy here.')}</div>`}</div>
      <div class="card pad" style="align-self:flex-start"><h3 class="t">Add note</h3><textarea class="input" id="nb" placeholder="What happened, what to do next…"></textarea><button class="btn primary" style="margin-top:10px" onclick="addNote(${m.id})">Add note</button></div></div>`;
  }

  if (tab === 'details') {
    const det = m.details || {};
    T.innerHTML = `<div class="card pad"><div class="small muted" style="margin-bottom:16px">These details fill your drafts automatically. Anything left blank appears as a <span class="pill warn">[[placeholder]]</span> — Nyaay never guesses names, amounts or dates.</div>
      <div class="grid g2" style="gap:4px 18px">${Object.entries(tpl.fields).map(([k, l]) => `<div class="field"><label class="f">${esc(l)}</label>${k.includes('address') || k === 'liability' ? `<textarea class="input" id="d_${k}" style="min-height:64px">${esc(det[k] || '')}</textarea>` : `<input class="input" id="d_${k}" value="${esc(det[k] || '')}">`}</div>`).join('')}</div>
      <button class="btn primary" onclick="saveDetails(${m.id})">Save details</button></div>`;
  }
}
async function saveFacts(id) {
  const facts = {}; $$('[id^=f_]').forEach(i => { if (i.value) facts[i.id.slice(2)] = i.value; });
  if (!Object.keys(facts).length) return toast('Enter at least one date', true);
  await api(`/matters/${id}/facts`, { method: 'PUT', json: { facts } }); toast('Dates saved · deadlines recalculated'); route();
}
async function saveDetails(id) {
  const details = {}; $$('[id^=d_]').forEach(i => details[i.id.slice(2)] = i.value.trim());
  await api('/matters/' + id, { method: 'PATCH', json: { details } }); toast('Details saved');
}
async function addOrder(id) {
  const f = new FormData();
  if ($('#of').files[0]) f.append('file', $('#of').files[0]);
  if ($('#ot').value.trim()) f.append('text', $('#ot').value);
  if (![...f.keys()].length) return toast('Paste the order or choose a file', true);
  f.append('language', $('#ol').value);
  const b = $('#obtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Reading…';
  try {
    const r = await api(`/matters/${id}/orders`, { form: f, method: 'POST' });
    toast(`Order read · ${r.proposed_tasks.length} task(s) proposed for approval`); refreshCounts(); location.hash = `#/m/${id}/tasks`;
  } catch (e) { fail(e); b.disabled = false; b.innerHTML = 'Read order'; }
}
async function decide(tid, what) {
  await api(`/tasks/${tid}/${what}`, { json: {} });
  toast(what === 'approve' ? 'Approved' : what === 'reject' ? 'Rejected' : 'Marked done'); refreshCounts(); route();
}
async function addNote(id) { const v = $('#nb').value.trim(); if (!v) return; await api(`/matters/${id}/notes`, { json: { body: v } }); toast('Note added'); route(); }
async function delNote(nid) { await api('/notes/' + nid, { method: 'DELETE' }); toast('Note deleted'); route(); }
async function editMatter(id) {
  const [d] = await Promise.all([api('/matters/' + id), loadPlaybook()]); const m = d.matter;
  const inp = (k, l, t = 'text') => `<div class="field"><label class="f">${l}</label><input class="input" type="${t}" id="e_${k}" value="${esc(m[k] || '')}"></div>`;
  modal('Edit matter', `${inp('title', 'Cause title')}<div class="grid g2" style="gap:0 12px">${inp('client_name', 'Client')}${inp('court', 'Court')}${inp('case_number', 'Case number')}${inp('cnr', 'CNR')}
    <div class="field"><label class="f">Stage</label><select class="input" id="e_current_stage"><option value="">Not set</option>${S.playbook.stages.map(s => `<option value="${s.id}" ${m.current_stage === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    ${inp('next_date', 'Next date', 'date')}<div class="field"><label class="f">Status</label><select class="input" id="e_status">${['active', 'on_hold', 'closed'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s === 'on_hold' ? 'On hold' : s}</option>`).join('')}</select></div></div>${inp('goal', 'Goal')}${isAdmin() ? `<div class="divider"></div><div class="row"><span class="small muted grow">Permanently erase this matter and all its orders, tasks, notes and drafts.</span><button class="btn danger sm" type="button" onclick="eraseMatter(${id})">${I('trash')}Erase matter</button></div>` : ''}`,
  { ok: async ov => {
    const body = {}; ['title', 'client_name', 'court', 'case_number', 'cnr', 'goal', 'status', 'current_stage', 'next_date'].forEach(k => { const v = $('#e_' + k, ov).value.trim(); body[k] = v || null; });
    if (!body.title) { toast('Title required', true); return false; }
    if (!body.current_stage) delete body.current_stage;
    await api('/matters/' + id, { method: 'PATCH', json: body }); toast('Matter updated'); route();
  } });
}

/* ================================================================ calendar */
async function viewCalendar(p) {
  await loadMatters();
  const base = p.m ? parseISO(p.m + '-01') : new Date(); base.setDate(1);
  const start = new Date(base); start.setDate(1 - ((base.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 41);
  const r = await api(`/calendar?start=${iso(start)}&end=${iso(end)}`);
  const by = {}; r.events.forEach(e => (by[e.date] = by[e.date] || []).push(e));
  const mk = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
  let sel = p.d || (TODAY >= iso(start) && TODAY <= iso(end) ? TODAY : iso(base));
  $('#view').innerHTML = `<div class="page-head"><div class="grow"><div class="eyebrow">Practice</div><h1 class="page">${base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h1><div class="legend" style="margin-top:6px"><span class="lg-hearing">Hearing</span><span class="lg-deadline">Statutory deadline</span><span class="lg-task">Approved task</span></div></div>
    <div class="actions"><button class="btn" onclick="location.hash='#/calendar?m=${mk(base, -1)}'">${I('chevL')}</button><button class="btn" onclick="location.hash='#/calendar'">Today</button><button class="btn" onclick="location.hash='#/calendar?m=${mk(base, 1)}'">${I('chevR')}</button></div></div>
  <div class="grid g-main"><div class="card" style="overflow:hidden"><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="dow">${x}</div>`).join('')}
    ${Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d); const ev = by[k] || [];
      return `<div class="day ${d.getMonth() !== base.getMonth() ? 'out' : ''} ${k === TODAY ? 'today' : ''} ${k === sel ? 'sel' : ''}" data-d="${k}"><div class="dn">${d.getDate()}</div>${ev.slice(0, 3).map(e => `<div class="e ${e.type}">${esc(e.title)}</div>`).join('')}${ev.length > 3 ? `<div class="small faint">+${ev.length - 3} more</div>` : ''}</div>`; }).join('')}</div></div>
    <div class="card" style="align-self:flex-start"><div class="card-h"><h3 id="cday"></h3></div><div id="clist"></div></div></div>`;
  const showDay = k => {
    sel = k; $$('.cal .day').forEach(x => x.classList.toggle('sel', x.dataset.d === k));
    $('#cday').textContent = parseISO(k).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const ev = by[k] || [];
    $('#clist').innerHTML = ev.length ? `<div class="list">${ev.map(e => `<div class="li"><div class="body"><div class="row"><span class="pill ${e.type === 'hearing' ? 'info' : e.type === 'deadline' ? 'bad' : 'brass'}">${e.type}</span>${e.status === 'proposed' ? '<span class="pill neutral">awaiting approval</span>' : ''}</div>
      <a class="ttl" href="#/m/${e.matter_id}" style="display:block;margin-top:6px">${esc(e.title)}</a><div class="meta">${esc(e.detail || '')}</div></div></div>`).join('')}</div>` : `<div class="card-b muted small">Nothing on this day.</div>`;
  };
  $$('.cal .day').forEach(x => x.onclick = () => showDay(x.dataset.d));
  showDay(sel);
}

/* ================================================================ approvals */
async function viewApprovals() {
  const [t] = await Promise.all([api('/tasks?status=proposed'), loadMatters()]);
  const groups = {}; t.forEach(x => (groups[x.matter_id] = groups[x.matter_id] || []).push(x));
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Practice</div><h1 class="page">Approvals</h1><div class="sub">Nyaay only proposes. Nothing changes a matter until you approve it — every decision is logged.</div></div></div>
  ${t.length ? Object.entries(groups).map(([mid, arr]) => `<div class="card" style="margin-bottom:16px"><div class="card-h">${I('brief')}<h3><a href="#/m/${mid}">${esc(matterTitle(+mid))}</a></h3><div class="r"><span class="small muted">${arr.length} proposed</span><button class="btn sm" ${canDecide() ? '' : 'disabled'} onclick="approveAll([${arr.map(x => x.id).join(',')}])">${I('check')}Approve all</button></div></div>
    ${arr.map(x => `<div class="task"><div class="grow"><div class="src-tag">${esc(x.source)}${x.action ? ' · changes the matter' : ''}${x.due_date ? ' · due ' + fmt(x.due_date) : ''}</div><div style="font-weight:500">${esc(x.title)}</div>${x.detail && x.detail !== x.title ? `<div class="small muted" style="white-space:pre-wrap">${esc(x.detail.slice(0, 260))}</div>` : ''}</div>
    ${canDecide() ? `<button class="btn ok sm" onclick="decide(${x.id},'approve')">${I('check')}Approve</button><button class="btn sm" onclick="decide(${x.id},'reject')">Reject</button>` : '<span class="pill warn">awaiting an advocate</span>'}</div>`).join('')}</div>`).join('')
  : `<div class="card">${empty('check', 'All caught up', 'No actions are waiting for your approval.')}</div>`}`;
}
async function approveAll(ids) {
  for (const id of ids) { try { await api(`/tasks/${id}/approve`, { json: {} }); } catch (e) { fail(e); } }
  toast(`${ids.length} approved`); refreshCounts(); route();
}

/* ================================================================ drafting */
async function viewDrafts() {
  const [list, tpl] = await Promise.all([api('/drafts'), loadTemplates(), loadMatters()]);
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Practice</div><h1 class="page">Drafting</h1><div class="sub">Court-ready drafts filled from your matter. Blanks stay visible — nothing is invented.</div></div>
    <div class="actions"><button class="btn primary" onclick="newDraft()">${I('plus')}New draft</button></div></div>
  <h3 class="t">Templates</h3><div class="grid g3" style="margin-bottom:26px">${tpl.templates.map(t => `<div class="card tpl" onclick="newDraft(null,'${t.id}')"><div class="g">${esc(t.group)}</div><div class="n">${esc(t.name)}</div><div class="small muted" style="margin-top:6px">${t.fields.length} fields${t.dates.length ? ' · uses ' + t.dates.length + ' confirmed date(s)' : ''}</div></div>`).join('')}</div>
  <div class="card"><div class="card-h"><h3>Your drafts</h3><div class="r small muted">${list.length}</div></div>
    ${list.length ? `<table class="tbl"><tr><th>Draft</th><th>Matter</th><th>Blanks</th><th>Status</th><th>Updated</th></tr>${list.map(x => `<tr class="click" onclick="location.hash='#/d/${x.id}'"><td class="title">${esc(x.title)}</td><td class="small">${esc(x.matter || '—')}</td><td>${x.placeholders ? `<span class="pill warn">${x.placeholders}</span>` : '<span class="pill ok">0</span>'}</td><td><span class="pill ${x.status === 'final' ? 'ok' : 'neutral'}">${esc(x.status)}</span></td><td class="small muted nowrap">${ago(x.updated_at)}</td></tr>`).join('')}</table>`
    : empty('pen', 'No drafts yet', 'Pick a template above to start.')}</div>`;
}
async function newDraft(matterId, tplId) {
  const [tpl] = await Promise.all([loadTemplates(), loadMatters()]);
  const ov = modal('New draft', `<div class="field"><label class="f">Template</label><select class="input" id="nd_t">${tpl.templates.map(t => `<option value="${t.id}" ${t.id === tplId ? 'selected' : ''}>${esc(t.group)} — ${esc(t.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="f">Matter</label><select class="input" id="nd_m">${matterOptions(matterId, 'No matter (blank template)')}</select></div>
    <div id="nd_f"></div>`, { okText: 'Create draft', wide: false, ok: async o => {
    const extra = {}; $$('[id^=x_]', o).forEach(i => { if (i.value.trim()) extra[i.id.slice(2)] = i.value.trim(); });
    const mid = $('#nd_m', o).value ? +$('#nd_m', o).value : null;
    if (mid && Object.keys(extra).length) await api('/matters/' + mid, { method: 'PATCH', json: { details: extra } });
    await createDraft($('#nd_t', o).value, mid, extra);
  } });
  const o = ov.el;
  const refresh = async () => {
    const t = tpl.templates.find(x => x.id === $('#nd_t', o).value); const mid = $('#nd_m', o).value;
    let det = {}; if (mid) { try { det = (await api('/matters/' + mid)).matter.details || {}; } catch { /* ignore */ } }
    const miss = t.fields.filter(f => !det[f]);
    $('#nd_f', o).innerHTML = miss.length ? `<div class="divider"></div><div class="small muted" style="margin-bottom:10px">${mid ? 'Missing from this matter — fill now (saved to the matter) or leave as blanks:' : 'Fill what you know; the rest stays as [[blanks]]:'}</div>
      <div class="grid g2" style="gap:0 12px">${miss.map(f => `<div class="field"><label class="f">${esc(tpl.fields[f])}</label><input class="input" id="x_${f}"></div>`).join('')}</div>` : `<div class="small" style="color:var(--good)">${I('check').replace('<svg', '<svg style="width:14px;vertical-align:-2px"')} All fields for this template are already on the matter.</div>`;
  };
  $('#nd_t', o).onchange = refresh; $('#nd_m', o).onchange = refresh; refresh();
}
async function createDraft(template, matter_id, extra = {}) {
  const d = await api('/drafts', { json: { template, matter_id, extra } });
  toast(d.placeholders.length ? `Draft created · ${d.placeholders.length} blank(s) to fill` : 'Draft created'); refreshCounts(); location.hash = '#/d/' + d.id;
}
async function viewDraft(p, id) {
  const [d] = await Promise.all([api('/drafts/' + id), loadMatters()]);
  let dirty = false;
  $('#view').innerHTML = `<div class="row" style="margin-bottom:12px"><a class="small" href="#/drafts">← All drafts</a>${d.matter_id ? `<span class="faint">·</span><a class="small" href="#/m/${d.matter_id}/drafts">${esc(matterTitle(d.matter_id))}</a>` : ''}</div>
  <div class="grid g-read"><div><input class="input" id="dt" value="${esc(d.title)}" style="font-family:var(--serif);font-size:24px;height:48px;font-weight:600;margin-bottom:14px;border-color:transparent;background:transparent;padding:0 4px">
    <div class="sheet"><textarea id="db" spellcheck="true">${esc(d.body)}</textarea></div></div>
  <div class="rail"><div class="card pad"><div class="row"><span class="pill ${d.status === 'final' ? 'ok' : 'neutral'}" id="dst">${esc(d.status)}</span><span class="small muted" id="dsave">Saved</span></div>
    <div style="display:grid;gap:8px;margin-top:14px"><button class="btn primary" onclick="saveDraft(${d.id})">Save <span class="kbd" style="margin-left:auto;background:transparent;color:inherit;border-color:rgba(255,255,255,.3)">Ctrl S</span></button>
      <button class="btn" onclick="exportDraft(${d.id})">${I('download')}Export Word (.docx)</button>
      <button class="btn" onclick="copy(document.getElementById('db').value,'Draft copied')">${I('copy')}Copy text</button>
      <button class="btn" onclick="checkDraftCites()">${I('shield')}Check citations</button>
      <button class="btn" onclick="polishDraft(${d.id})">${I('wand')}AI polish (wording only)</button>
      <button class="btn" onclick="finalDraft(${d.id})">${I('seal')}Mark final</button>
      <button class="btn danger" onclick="delDraft(${d.id})">${I('trash')}Delete</button></div></div>
    <div class="card pad"><h3 class="t">Blanks to fill <span class="faint" id="phn"></span></h3><div class="ph-list" id="phl"></div></div>
    <div class="card pad"><h3 class="t">Template review</h3>${revPill(d.template_review, true)}<div class="small muted" style="margin-top:6px">${d.template_review === 'approved' ? 'An advocate in your firm signed off this template version.' : 'No advocate in your firm has signed off this template yet — <a href="#/settings/review">review it</a>.'}</div><div style="margin-top:8px">${thumbs('draft', d.template)}</div></div>
    <div class="card pad small muted">Templates are drafts for an advocate's review. Verify limitation, jurisdiction and every fact against the records before filing or sending.</div></div></div>`;
  const ta = $('#db');
  const drawPH = () => {
    const ph = [...new Set(ta.value.match(/\[\[[^\]]+\]\]/g) || [])];
    $('#phn').textContent = `(${ph.length})`;
    $('#phl').innerHTML = ph.length ? ph.map(x => `<button data-ph="${esc(x)}">${esc(x)}</button>`).join('') : `<div class="small" style="color:var(--good)">No blanks left.</div>`;
    $$('#phl button').forEach(b => b.onclick = () => { const i = ta.value.indexOf(b.dataset.ph); if (i >= 0) { ta.focus(); ta.setSelectionRange(i, i + b.dataset.ph.length); const lines = ta.value.slice(0, i).split('\n').length; ta.scrollTop = Math.max(0, lines * 28 - 200); } });
  };
  const auto = debounce(() => saveDraft(d.id, true), 1500);
  const mark = () => { dirty = true; $('#dsave').textContent = 'Unsaved changes'; drawPH(); auto(); };
  ta.oninput = mark; $('#dt').oninput = mark;
  drawPH();
  leaveGuard = () => { if (dirty && $('#db')) api('/drafts/' + d.id, { method: 'PUT', json: { title: $('#dt').value.trim() || 'Untitled draft', body: $('#db').value } }).catch(fail); return true; };
  window._draftKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('#db')) { e.preventDefault(); saveDraft(d.id); } };
  window._draftSaved = () => { dirty = false; };
}
document.addEventListener('keydown', e => window._draftKey && window._draftKey(e));
async function saveDraft(id, quiet) {
  if (!$('#db')) return;
  await api('/drafts/' + id, { method: 'PUT', json: { title: $('#dt').value.trim() || 'Untitled draft', body: $('#db').value } });
  window._draftSaved && window._draftSaved(); $('#dsave').textContent = 'Saved'; if (!quiet) toast('Draft saved');
}
async function exportDraft(id) {
  await saveDraft(id, true);
  const r = await api(`/drafts/${id}/export?format=docx`, { raw: true });
  if (!r.ok) return toast('Export failed', true);
  const blob = await r.blob(); const cd = r.headers.get('Content-Disposition') || ''; const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'draft.docx';
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(name.endsWith('.txt') ? 'Exported as text (install python-docx for Word)' : 'Exported ' + name);
}
async function finalDraft(id) {
  await saveDraft(id, true);
  try { await api('/drafts/' + id, { method: 'PUT', json: { status: 'final' } }); $('#dst').textContent = 'final'; $('#dst').className = 'pill ok'; toast('Marked final'); } catch (e) { fail(e); }
}
async function delDraft(id) {
  modal('Delete draft?', 'This draft will be permanently deleted.', { okText: 'Delete', ok: async () => { await api('/drafts/' + id, { method: 'DELETE' }); window._draftSaved && window._draftSaved(); leaveGuard = null; toast('Draft deleted'); location.hash = '#/drafts'; } });
}
async function polishDraft(id) {
  await saveDraft(id, true);
  const m = modal('AI polish', '<span class="spin"></span> <span class="muted">Improving wording…</span>', { wide: true, foot: false });
  try {
    const r = await api(`/drafts/${id}/polish`, { json: {} });
    $('.modal-b', m.el).innerHTML = `${r.problems.length ? `<div class="gate bad" style="margin-bottom:12px">${I('alert')}<div><b>Suggestion blocked.</b> ${esc(r.problems.join('; '))}. Your draft is unchanged.</div></div>` : `<div class="gate ok" style="margin-bottom:12px">${I('check')}<div>Checked: every blank kept, no new numbers or citations.</div></div>`}
      ${r.changes.length ? `<div class="small" style="margin-bottom:10px"><b>Changes:</b> ${r.changes.map(esc).join(' · ')}</div>` : ''}
      <div class="diff"><div><div class="small muted" style="margin-bottom:6px">Current</div><pre>${esc($('#db').value)}</pre></div><div><div class="small muted" style="margin-bottom:6px">Suggested</div><pre>${esc(r.body)}</pre></div></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x2>Discard</button>${r.accepted ? '<button class="btn primary" data-acc>Accept suggestion</button>' : ''}</div>`;
    $('[data-x2]', m.el).onclick = m.close;
    const acc = $('[data-acc]', m.el); if (acc) acc.onclick = async () => { $('#db').value = r.body; await saveDraft(id); m.close(); route(); };
  } catch (e) { m.close(); fail(e); }
}
async function checkDraftCites() {
  const r = await api('/citations/check', { json: { text: $('#db').value } });
  modal('Citation check', r.items.length ? citeResults(r, true) : empty('shield', 'No citations found', 'This draft does not cite any case law.'), { wide: true, cancelText: 'Close' });
}

/* ================================================================ clients */
async function viewClients() {
  const c = await api('/clients');
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Practice</div><h1 class="page">Clients</h1><div class="sub">${c.length} client${c.length === 1 ? '' : 's'}</div></div><div class="actions"><button class="btn primary" onclick="newMatter()">${I('plus')}New matter</button></div></div>
  ${c.length ? `<div class="grid g3">${c.map(x => `<div class="card pad"><div class="row"><div class="avatar" style="background:var(--brass)">${esc(x.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div><div class="grow"><div class="serif" style="font-size:20px;font-weight:600;line-height:1.2">${esc(x.name)}</div><div class="small muted">${x.active} active · ${x.matters.length} total${x.next_date ? ' · next ' + fmt(x.next_date) : ''}</div></div></div>
    <div class="divider"></div>${x.matters.map(m => `<div class="linkrow"><a href="#/m/${m.id}">${esc(m.title)}</a> <span class="small faint">${m.next_date ? fmt(m.next_date) : ''}</span></div>`).join('')}</div>`).join('')}</div>`
  : `<div class="card">${empty('users', 'No clients yet', 'Clients appear when you add a client name to a matter.')}</div>`}`;
}

/* ================================================================ citation check */
async function viewCheck() {
  await loadMatters();
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Tools</div><h1 class="page">Citation check</h1><div class="sub">Paste a draft. Every citation is matched to a real judgment and the paragraph that supports the point. Unverified authorities block export.</div></div></div>
  <div class="grid g-main"><div class="card pad"><div class="field"><label class="f">Draft text</label><textarea class="input" id="ct" style="min-height:280px;font-family:var(--read);font-size:15px" placeholder="…as held in Sample Finance Ltd v. Demo Traders, 2099 INSC 1, the presumption under Section 139 is rebuttable…"></textarea></div>
    <div class="row"><input class="input" type="file" id="cf" style="padding:7px;max-width:300px"><select class="input" id="cm" style="max-width:280px">${matterOptions('', 'Not linked to a matter')}</select><button class="btn primary" id="cbtn" style="margin-left:auto" onclick="runCheck()">${I('shield')}Check citations</button></div></div>
    <div class="card pad" style="align-self:flex-start"><h3 class="t">What the statuses mean</h3>
      ${[['VERIFIED', 'Found, and the paragraph supports the point (AI-checked).'], ['EXISTS_UNCHECKED', 'Found; support not yet checked — read the paragraph.'], ['EXISTS_NOT_SUPPORTED', 'Found, but the closest paragraphs do not support the point.'], ['CITATION_MISMATCH', 'Citation and case name point to different judgments.'], ['FOUND_EXTERNALLY', 'Not in your library, found on Indian Kanoon — open and read it.'], ['NOT_IN_LIBRARY', 'Not in your library. Not an error by itself: most SCC/AIR reports are not in open data.']].map(([s, t]) => `<div class="row top" style="margin-bottom:10px"><span class="pill ${s}" style="min-width:150px;justify-content:center">${s.replace(/_/g, ' ')}</span><span class="small muted grow">${t}</span></div>`).join('')}</div></div>
  <div id="cres" style="margin-top:18px"></div>`;
}
async function runCheck() {
  const b = $('#cbtn'); b.disabled = true; const old = b.innerHTML; b.innerHTML = '<span class="spin"></span> Checking…';
  try {
    let r; const mid = $('#cm').value ? +$('#cm').value : null;
    if ($('#cf').files[0]) { const f = new FormData(); f.append('file', $('#cf').files[0]); if (mid) f.append('matter_id', mid); r = await api('/citations/check-file', { form: f, method: 'POST' }); }
    else { if (!$('#ct').value.trim()) throw new Error('Paste a draft or choose a file'); r = await api('/citations/check', { json: { text: $('#ct').value, matter_id: mid } }); }
    window._check = r; $('#cres').innerHTML = r.items.length ? citeResults(r) : `<div class="card">${empty('shield', 'No citations found', 'Supported formats: 2024 INSC 123, (2019) 5 SCC 418, 2023 SCC OnLine SC 456, AIR 2010 SC 100, [2015] 3 SCR 200.')}</div>`;
  } catch (e) { fail(e); } finally { b.disabled = false; b.innerHTML = old; }
}
function citeResults(r, inModal) {
  const s = r.summary;
  return `<div class="gate ${s.can_export ? 'ok' : 'bad'}" style="margin-bottom:14px">${I(s.can_export ? 'check' : 'alert')}<div><b>${s.can_export ? 'Ready to file.' : 'Not ready to file.'}</b> ${s.total} citation(s) · ${Object.entries(s.counts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ').toLowerCase()}`).join(', ')}${s.can_export ? '' : ` · ${s.blockers.length} need attention`}</div></div>
  <div class="card">${r.items.map(it => `<div class="ccrow"><div class="row"><span class="pill ${it.status}">${it.status.replace(/_/g, ' ')}</span><b class="cite" style="font-size:13px">${esc(it.citation)}</b>${it.case_name ? `<span class="muted small">${esc(it.case_name)}</span>` : ''}
      ${it.advocate_confirmed ? `<span class="pill ok">Confirmed by ${esc(it.confirmed_by || 'advocate')}</span>` : (!inModal && canDecide() && it.status !== 'VERIFIED' ? `<button class="btn sm" style="margin-left:auto" onclick="confirmCite(${r.id},${it.index})">I have read it</button>` : '')}</div>
    <div class="small" style="margin:8px 0">${esc(it.message)}</div>
    ${it.judgment_id ? `<div class="small">Matched: <a href="#/j/${enc(it.judgment_id)}${it.paragraphs[0] ? '?p=' + it.paragraphs[0].no : ''}">${esc(it.judgment_title)}</a> <span class="faint">· ${esc(it.court || '')}</span></div>` : ''}
    ${it.external ? `<div class="small">Indian Kanoon: <a href="${esc(it.external.url)}" target="_blank" rel="noopener">${esc(it.external.title)}</a> <span class="faint">· ${esc(it.external.docsource || '')}</span></div>` : ''}
    ${!it.judgment_id && it.search_url ? `<div class="small"><a href="${esc(it.search_url)}" target="_blank" rel="noopener">Search this citation on Indian Kanoon →</a></div>` : ''}
    ${it.paragraphs.slice(0, 1).map(p => `<div class="snip"><span class="pn">¶ ${p.no}</span>${esc(p.text.slice(0, 500))}${p.text.length > 500 ? '…' : ''}</div>`).join('')}
    ${it.support?.reason ? `<div class="small muted">${esc(it.support.reason)}</div>` : ''}</div>`).join('')}</div>`;
}
async function confirmCite(cid, idx) { const r = await api(`/citations/${cid}/items/${idx}/confirm`, { json: {} }); $('#cres').innerHTML = citeResults(r); toast('Recorded in the audit log'); }


function revPill(st, big) {
  if (!st || S.me?.firm?.settings?.require_review === false) return '';
  const m = { approved: ['ok', 'Reviewed'], unreviewed: ['warn', 'Not yet reviewed'], outdated: ['warn', 'Changed since review'], changes_requested: ['bad', 'Change requested'] }[st];
  return m ? ` <span class="pill ${m[0]}" title="Advocate review of this rule/template">${big ? '' : ''}${m[1]}</span>` : '';
}
async function syncMatter(id) {
  toast('Syncing with eCourts…');
  try { const r = await api(`/matters/${id}/sync`, { json: {} }); toast(`eCourts: ${r.new_orders} new order(s), ${r.proposed_tasks} proposal(s)`); refreshCounts(); route(); } catch (e) { fail(e); }
}
async function eraseMatter(id) {
  if (!confirm('Erase this matter permanently? This cannot be undone.')) return;
  await api('/matters/' + id, { method: 'DELETE' }); $('.overlay')?.remove(); toast('Matter erased'); location.hash = '#/matters';
}
