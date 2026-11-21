/* Nyaay — sign-in, first-run setup, invite acceptance, profile & account menu. */
'use strict';

function authShell(inner) {
  document.body.classList.add('auth-mode');
  let el = $('#authscreen');
  if (!el) { el = document.createElement('div'); el.id = 'authscreen'; document.body.appendChild(el); }
  el.innerHTML = `<div class="auth-wrap"><div class="auth-side"><div class="brand" style="border:0;padding:0"><div class="seal">${I('scale')}</div><div><div class="name">Nyaay</div><div class="tag">Chambers · India</div></div></div>
    <div class="auth-quote"><div class="ornament">✦ ✦ ✦</div><p>Research, matters, deadlines and drafts — in one place, with every authority checked and every action yours to approve.</p></div>
    <ul class="auth-points"><li>${I('shield')}Citations matched to the paragraph</li><li>${I('clock')}Statutory deadlines by rule, holiday-aware</li><li>${I('inbox')}AI proposes, advocates approve</li><li>${I('seal')}Client data stays with your firm</li></ul></div>
    <div class="auth-main"><div class="auth-card">${inner}</div></div></div>`;
  setTimeout(() => { const f = $('#authscreen input'); if (f) f.focus(); }, 30);
}
function hideAuth() { document.body.classList.remove('auth-mode'); $('#authscreen')?.remove(); }

async function showAuth(mode, arg) {
  if (mode === 'setup') {
    authShell(`<div class="eyebrow">First-time setup</div><h1 class="page" style="font-size:30px">Create your chambers</h1><div class="sub" style="margin-bottom:18px">You will be the owner. Invite colleagues afterwards.</div>
      <form id="af"><div class="field"><label class="f">Firm or chambers name</label><input class="input" name="firm_name" required placeholder="e.g. Deshmukh & Associates"></div>
      <div class="field"><label class="f">Your name</label><input class="input" name="name" required placeholder="Adv. A. Deshmukh"></div>
      <div class="field"><label class="f">Email</label><input class="input" name="email" type="email" required autocomplete="username"></div>
      <div class="field"><label class="f">Password (10+ characters)</label><input class="input" name="password" type="password" required minlength="10" autocomplete="new-password"></div>
      <div class="field"><label class="f">Bar Council enrolment no. (optional)</label><input class="input" name="enrolment_no" placeholder="MAH/1234/2015"></div>
      <label class="row small" style="margin-bottom:16px;gap:8px"><input type="checkbox" name="demo" checked> Add 5 fictional demo matters to explore</label>
      <button class="btn primary" style="width:100%;justify-content:center;height:42px">Create and continue</button></form>`);
    $('#af').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
      try { await api('/auth/setup', { json: { firm_name: f.get('firm_name'), name: f.get('name'), email: f.get('email'), password: f.get('password'), enrolment_no: f.get('enrolment_no') || null, demo: !!f.get('demo') } }); location.hash = '#/'; start(); }
      catch (err) { fail(err); } };
    return;
  }
  if (mode === 'accept') {
    let info; try { info = await api('/auth/invite/' + enc(arg)); } catch (e) { authShell(`<h1 class="page" style="font-size:28px">Invite not valid</h1><p class="muted">${esc(e.message)}</p><a class="btn" href="#/" onclick="showAuth('login')">Go to sign in</a>`); return; }
    authShell(`<div class="eyebrow">Invitation</div><h1 class="page" style="font-size:30px">Join ${esc(info.firm)}</h1><div class="sub" style="margin-bottom:18px">${esc(info.email)} · role: ${esc(info.role)}</div>
      <form id="af"><div class="field"><label class="f">Your name</label><input class="input" name="name" required></div>
      <div class="field"><label class="f">Choose a password (10+ characters)</label><input class="input" name="password" type="password" minlength="10" required autocomplete="new-password"></div>
      <div class="field"><label class="f">Bar Council enrolment no. (advocates)</label><input class="input" name="enrolment_no"></div>
      <button class="btn primary" style="width:100%;justify-content:center;height:42px">Join</button></form>`);
    $('#af').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
      try { await api('/auth/accept', { json: { token: arg, name: f.get('name'), password: f.get('password'), enrolment_no: f.get('enrolment_no') || null } }); location.hash = '#/'; start(); } catch (err) { fail(err); } };
    return;
  }
  authShell(`<div class="eyebrow">Welcome back</div><h1 class="page" style="font-size:32px">Sign in</h1><div class="sub" style="margin-bottom:20px">to your chambers</div>
    <form id="af"><div class="field"><label class="f">Email</label><input class="input" name="email" type="email" required autocomplete="username"></div>
    <div class="field"><label class="f">Password</label><input class="input" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn primary" style="width:100%;justify-content:center;height:42px">Sign in</button></form>
    <div class="small faint" style="margin-top:16px">New colleague? Ask your firm's admin for an invite link.</div>`);
  $('#af').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
    try { await api('/auth/login', { json: { email: f.get('email'), password: f.get('password') } }); start(); } catch (err) { fail(err); } };
}

async function signOut() { try { await api('/auth/logout', { json: {} }); } catch { /* ignore */ } S.me = null; showAuth('login'); }

function accountMenu() {
  const u = S.me.user;
  const m = modal('Your account', `<div class="row" style="margin-bottom:16px"><div class="avatar" style="width:46px;height:46px;font-size:16px">${esc(initials(u.name))}</div><div><div class="serif" style="font-size:20px;font-weight:600">${esc(u.name)}</div><div class="small muted">${esc(u.email)} · ${esc(u.role)} · ${esc(S.me.firm.name)}</div></div></div>
    <div class="grid g2" style="gap:0 12px"><div class="field"><label class="f">Name</label><input class="input" id="p_name" value="${esc(u.name)}"></div>
    <div class="field"><label class="f">Bar Council enrolment no.</label><input class="input" id="p_enr" value="${esc(u.enrolment_no || '')}" placeholder="needed to sign off reviews"></div>
    <div class="field"><label class="f">WhatsApp number</label><input class="input" id="p_phone" value="${esc(u.phone ? '+' + u.phone : '')}" placeholder="+91 98xxxxxxxx"></div>
    <div class="field"><label class="f">&nbsp;</label><label class="row small" style="height:38px;gap:8px"><input type="checkbox" id="p_wa" ${u.whatsapp_brief ? 'checked' : ''}> Send my morning brief on WhatsApp</label></div></div>
    <div class="divider"></div><h3 class="t">Change password</h3><div class="grid g2" style="gap:0 12px"><div class="field"><input class="input" type="password" id="p_cur" placeholder="Current password" autocomplete="current-password"></div><div class="field"><input class="input" type="password" id="p_new" placeholder="New password (10+)" autocomplete="new-password"></div></div>
    <div class="row"><button class="btn danger" id="p_out">${I('back')}Sign out</button></div>`,
  { okText: 'Save', ok: async ov => {
    const me = await api('/auth/me', { method: 'PATCH', json: { name: $('#p_name', ov).value.trim(), enrolment_no: $('#p_enr', ov).value.trim() || null, phone: $('#p_phone', ov).value.trim() || null, whatsapp_brief: $('#p_wa', ov).checked } });
    S.me.user = me;
    if ($('#p_new', ov).value) await api('/auth/password', { json: { current: $('#p_cur', ov).value, new: $('#p_new', ov).value } });
    toast('Account saved'); renderTop();
  } });
  $('#p_out', m.el).onclick = () => { m.close(); signOut(); };
}
const initials = n => (n || '?').replace(/^adv\.?\s+/i, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function renderTop() {
  const av = $('.avatar'); if (!av || !S.me) return;
  av.textContent = initials(S.me.user.name); av.title = S.me.user.name + ' — account'; av.style.cursor = 'pointer'; av.onclick = accountMenu;
}
