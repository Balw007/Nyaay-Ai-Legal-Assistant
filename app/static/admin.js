/* Nyaay — Settings: firm & privacy, team, court holidays, advocate review, usage & pilot metrics, data & integrations. */
'use strict';

const STABS = [['firm', 'Firm & privacy'], ['team', 'Team'], ['holidays', 'Court holidays'], ['review', 'Advocate review'],
  ['usage', 'Usage & pilot'], ['data', 'Data & integrations']];
const fmtN = n => Number(n || 0).toLocaleString('en-IN');
const codeLine = c => `<div class="row" style="margin:6px 0;flex-wrap:nowrap"><code class="cmd">${esc(c)}</code><button class="btn ghost sm" onclick="copy(${esc(JSON.stringify(c))},'Command copied')">${I('copy')}</button></div>`;

async function viewSettings(p, tab = 'firm') {
  $('#view').innerHTML = `<div class="page-head"><div><div class="eyebrow">Tools</div><h1 class="page">Settings</h1><div class="sub">${esc(S.me.firm.name)} · signed in as ${esc(S.me.user.name)} (${esc(S.me.user.role)})</div></div></div>
    <div class="tabs">${STABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" onclick="location.hash='#/settings/${k}'">${l}</button>`).join('')}</div><div id="stab">${skel(4)}</div>`;
  await ({ firm: setFirm, team: setTeam, holidays: setHolidays, review: setReview, usage: setUsage, data: setData }[tab] || setFirm)();
}
const adminOnly = () => isAdmin() ? '' : '<div class="flag" style="margin-bottom:12px">' + I('alert') + 'Only owners and admins can change these.</div>';

async function setFirm() {
  const f = await api('/firm'); const s = f.settings; const dis = isAdmin() ? '' : 'disabled';
  const tog = (k, label, help) => `<label class="setting"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''} ${dis}><div><b>${label}</b><div class="small muted">${help}</div></div></label>`;
  const pct = Math.min(100, Math.round(f.usage_this_month / Math.max(1, f.budget) * 100));
  $('#stab').innerHTML = `${adminOnly()}<div class="grid g2"><div class="card pad"><h3 class="t">Firm</h3><div class="field"><label class="f">Name</label><input class="input" id="fn" value="${esc(f.name)}" ${dis}></div>
    <h3 class="t" style="margin-top:18px">AI & privacy</h3>
    ${tog('ai_enabled', 'Use AI', 'Off = nothing is ever sent to an AI provider. Search, deadlines, drafting and citation matching keep working.')}
    ${tog('redact_pii', 'Redact identifiers before AI', 'Aadhaar, PAN, phone, email, IFSC and account numbers are swapped for tokens and restored in the reply.')}
    ${tog('rerank', 'AI re-ranking of research results', 'Better answers; uses a small number of fast-model tokens per question.')}
    ${tog('require_review', 'Show review status on deadlines and templates', 'Flags legal content no advocate in your firm has signed off.')}
    <div class="note small" style="margin-top:12px">AI calls go to Anthropic's API. Under its commercial terms, API inputs and outputs are not used to train models. Keep this setting off for matters where the client has not consented.</div></div>
    <div class="stack"><div class="card pad"><h3 class="t">Monthly AI allowance</h3><div class="row"><div class="grow"><div class="progress" style="width:100%;height:8px"><i style="width:${pct}%"></i></div></div><b>${pct}%</b></div>
      <div class="small muted" style="margin:6px 0 12px">${fmtN(f.usage_this_month)} of ${fmtN(f.budget)} tokens used this month. AI stops (and the app keeps working without it) when the allowance is reached.</div>
      <div class="field"><label class="f">Tokens per month</label><input class="input" type="number" id="fb" value="${f.budget}" ${dis}></div></div>
    <div class="card pad"><h3 class="t">Court working days</h3><div class="small muted" style="margin-bottom:8px">Used to move court-filing deadlines to the next open day (s.10 General Clauses Act).</div>
      <select class="input" id="fsat" ${dis}>${[['none', 'Saturdays are working days'], ['second_fourth', '2nd and 4th Saturdays closed'], ['all', 'All Saturdays closed']].map(([v, l]) => `<option value="${v}" ${s.closed_saturdays === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="small faint" style="margin-top:6px">Sundays are always treated as closed. Add court holidays in the Court holidays tab.</div></div>
    ${isAdmin() ? `<button class="btn primary" onclick="saveFirm()">Save settings</button>` : ''}</div></div>`;
}
async function saveFirm() {
  const settings = { monthly_token_budget: +$('#fb').value, closed_saturdays: $('#fsat').value };
  $$('[data-k]').forEach(i => settings[i.dataset.k] = i.checked);
  const f = await api('/firm', { method: 'PATCH', json: { name: $('#fn').value.trim(), settings } });
  S.me.firm.name = f.name; renderNav(currentNav); toast('Settings saved'); setFirm();
}

async function setTeam() {
  const t = await api('/team');
  $('#stab').innerHTML = `<div class="grid g-main"><div class="card"><div class="card-h"><h3>Members</h3><div class="r small muted">${t.users.length}</div></div>
    <table class="tbl"><tr><th>Name</th><th>Role</th><th>WhatsApp</th><th>Enrolment</th><th></th></tr>${t.users.map(u => `<tr><td><div class="title">${esc(u.name)}</div><div>${esc(u.email)}${u.active ? '' : ' · disabled'}</div></td>
      <td>${isAdmin() && u.role !== 'owner' && u.id !== S.me.user.id ? `<select class="input" style="height:32px;width:120px" onchange="patchMember(${u.id},{role:this.value})">${['admin', 'advocate', 'clerk'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : `<span class="pill neutral">${esc(u.role)}</span>`}</td>
      <td class="small">${u.phone ? '+' + esc(u.phone) : '<span class="faint">—</span>'}</td><td class="small">${esc(u.enrolment_no || '—')}</td>
      <td>${isAdmin() && u.role !== 'owner' && u.id !== S.me.user.id ? `<button class="btn sm ${u.active ? 'danger' : ''}" onclick="patchMember(${u.id},{active:${!u.active}})">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`).join('')}</table></div>
    <div class="stack">${isAdmin() ? `<div class="card pad"><h3 class="t">Invite a colleague</h3><div class="field"><label class="f">Email</label><input class="input" id="ie" type="email"></div>
      <div class="field"><label class="f">Role</label><select class="input" id="ir"><option value="advocate">Advocate — can approve actions and sign off</option><option value="clerk">Clerk — can prepare, cannot approve</option><option value="admin">Admin — manages team and settings</option></select></div>
      <button class="btn primary" onclick="sendInvite()">Create invite link</button><div id="ilink"></div></div>` : ''}
      ${t.invites.length ? `<div class="card pad"><h3 class="t">Pending invites</h3>${t.invites.map(i => `<div class="linkrow row"><span class="grow">${esc(i.email)} <span class="faint">(${esc(i.role)})</span></span>${isAdmin() ? `<button class="btn ghost sm" onclick="revokeInvite(${i.id})">${I('x')}</button>` : ''}</div>`).join('')}</div>` : ''}
      <div class="card pad small muted"><b style="color:var(--ink)">Roles.</b> Clerks prepare work; only advocates and above approve AI-proposed actions, confirm authorities and sign off legal content. Every decision records who made it.</div></div></div>`;
}
async function sendInvite() {
  const r = await api('/team/invites', { json: { email: $('#ie').value.trim(), role: $('#ir').value } });
  $('#ilink').innerHTML = `<div class="note small" style="margin-top:12px">${esc(r.note)}${codeLine(r.link)}</div>`; copy(r.link, 'Invite link copied');
}
async function patchMember(id, body) { await api('/team/' + id, { method: 'PATCH', json: body }); toast('Updated'); setTeam(); }
async function revokeInvite(id) { await api('/team/invites/' + id, { method: 'DELETE' }); setTeam(); }

async function setHolidays() {
  const yr = new Date().getFullYear();
  const h = await api('/holidays');
  $('#stab').innerHTML = `<div class="grid g-main"><div class="card"><div class="card-h"><h3>Court holidays</h3><div class="r small muted">${h.length} · court-filing deadlines move to the next open day</div></div>
    ${h.length ? `<table class="tbl">${h.map(x => `<tr><td class="nowrap">${fmt(x.day)}<div class="small faint">${parseISO(x.day).toLocaleDateString('en-IN', { weekday: 'long' })}</div></td><td>${esc(x.name)}</td><td class="small muted">${esc(x.court || 'All courts')}</td><td>${canDecide() ? `<button class="btn ghost sm" onclick="delHoliday(${x.id})">${I('trash')}</button>` : ''}</td></tr>`).join('')}</table>`
    : empty('cal', 'No holidays added', 'Import your High Court / district court holiday list so limitation dates fall on working days.')}</div>
    <div class="stack"><div class="card pad"><h3 class="t">Add one</h3><div class="field"><input class="input" type="date" id="hd"></div><div class="field"><input class="input" id="hn" placeholder="e.g. Diwali (Laxmi Puja)"></div>
      <div class="field"><input class="input" id="hc" placeholder="Court (blank = all), e.g. Pune"></div><button class="btn primary" onclick="addHoliday()">Add holiday</button></div>
    <div class="card pad"><h3 class="t">Import list (CSV)</h3><textarea class="input" id="hcsv" style="min-height:130px;font-family:var(--mono);font-size:12px" placeholder="date,name,court\n${yr}-10-20,Diwali,\n${yr}-12-25,Christmas,"></textarea>
      <button class="btn" style="margin-top:8px" onclick="importHolidays()">${I('upload')}Import</button><div class="hint-t">Copy rows from the court's official holiday notification. Dates: YYYY-MM-DD or DD-MM-YYYY.</div></div></div></div>`;
}
async function addHoliday() { const r = await api('/holidays', { json: { day: $('#hd').value, name: $('#hn').value, court: $('#hc').value } }); toast(`Added · ${r.matters_recomputed} matter(s) recalculated`); setHolidays(); }
async function importHolidays() { const r = await api('/holidays/import', { json: { csv: $('#hcsv').value } }); toast(`${r.added} added${r.bad_lines.length ? ` · lines skipped: ${r.bad_lines.join(', ')}` : ''}`); setHolidays(); }
async function delHoliday(id) { await api('/holidays/' + id, { method: 'DELETE' }); setHolidays(); }

async function setReview() {
  const r = await api('/reviews'); S.reviews = null;
  const groups = {}; r.items.forEach(i => (groups[i.group] = groups[i.group] || []).push(i));
  const pill = st => `<span class="pill ${st === 'approved' ? 'ok' : st === 'unreviewed' ? 'warn' : 'bad'}">${st.replace('_', ' ')}</span>`;
  $('#stab').innerHTML = `<div class="card pad" style="margin-bottom:16px"><div class="row"><div class="grow"><b class="serif" style="font-size:20px">${r.approved} of ${r.total} items signed off</b>
    <div class="small muted">Nyaay's deadline rules, case stages and draft templates are drafts until a practising advocate in your firm reviews them. Sign-off is per version: if the content changes, it needs review again.</div></div>
    <div class="progress" style="width:200px;height:8px"><i style="width:${Math.round(r.approved / r.total * 100)}%"></i></div></div>
    ${!S.me.user.enrolment_no ? `<div class="flag" style="margin-top:10px">${I('alert')}Add your Bar Council enrolment number (account menu, top right) to sign off.</div>` : ''}</div>
  ${Object.entries(groups).map(([g, items]) => `<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>${esc(g)}</h3></div>${items.map(i => `<div class="task"><div class="grow"><div class="src-tag">${esc(i.kind)} · v${esc(i.version.slice(0, 6))}</div><div style="font-weight:600">${esc(i.label)}</div>
    <div class="small muted" style="white-space:pre-wrap;max-height:${i.kind === 'template' ? '90px' : 'none'};overflow:hidden">${esc(i.detail)}</div>
    ${i.reviewer ? `<div class="small" style="margin-top:4px">${i.status === 'approved' ? 'Signed off' : 'Reviewed'} by <b>${esc(i.reviewer)}</b> (${esc(i.enrolment || '')}) ${ago(i.at)}${i.comment ? ' — “' + esc(i.comment) + '”' : ''}</div>` : ''}</div>
    <div style="display:grid;gap:6px;justify-items:end">${pill(i.status)}${canDecide() ? `<div class="row" style="gap:6px"><button class="btn ok sm" onclick="review('${i.kind}','${esc(i.ref)}','approved')">${I('check')}Sign off</button><button class="btn sm" onclick="review('${i.kind}','${esc(i.ref)}','changes_requested')">Request change</button></div>` : ''}</div></div>`).join('')}</div>`).join('')}`;
}
async function review(kind, ref, status) {
  let comment = '';
  if (status === 'changes_requested') { comment = prompt('What needs to change?') || ''; if (!comment.trim()) return; }
  await api('/reviews', { json: { kind, ref, status, comment } }); toast(status === 'approved' ? 'Signed off' : 'Change requested'); setReview();
}

async function setUsage() {
  const [u, m] = await Promise.all([api('/firm/usage'), isAdmin() ? api('/metrics') : Promise.resolve(null)]);
  const max = Math.max(1, ...u.daily.map(d => d.tokens));
  $('#stab').innerHTML = `<div class="grid g2"><div class="stack"><div class="card pad"><h3 class="t">AI usage this month</h3><div class="row"><span class="serif" style="font-size:34px;font-weight:600">${fmtN(u.month_tokens)}</span><span class="muted">of ${fmtN(u.budget)} tokens</span></div>
    <div class="spark">${u.daily.map(d => `<i title="${d.day}: ${fmtN(d.tokens)}" style="height:${Math.max(3, d.tokens / max * 60)}px"></i>`).join('') || '<span class="small faint">No AI use in the last 30 days</span>'}</div>
    <table class="tbl" style="margin-top:12px">${u.by_feature.map(f => `<tr><td>${esc(f.feature)}</td><td class="small muted">${f.calls} calls</td><td style="text-align:right;font-weight:600">${fmtN(f.tokens)}</td></tr>`).join('')}</table></div></div>
    ${m ? `<div class="stack"><div class="card pad"><h3 class="t">Pilot health — last 30 days</h3><div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:0">
      <div class="card kpi" style="cursor:default"><div class="lbl">Active this week</div><div class="val">${m.active_this_week}<span class="small muted">/${m.users}</span></div></div>
      <div class="card kpi" style="cursor:default"><div class="lbl">AI proposals accepted</div><div class="val">${m.ai_acceptance == null ? '—' : Math.round(m.ai_acceptance * 100) + '%'}</div><div class="hint">${m.ai_proposals_decided}/${m.ai_proposals} decided</div></div>
      <div class="card kpi" style="cursor:default"><div class="lbl">Feedback</div><div class="val" style="font-size:22px;white-space:nowrap">👍 ${m.feedback.up} &nbsp;👎 ${m.feedback.down}</div></div></div>
      <div class="small muted" style="margin:14px 0 6px">Weekly active users</div><div class="spark">${m.weekly_active.map(w => `<i title="${w.week}: ${w.users}" style="height:${Math.max(3, w.users / Math.max(1, m.users) * 60)}px"></i>`).join('')}</div></div>
      <div class="card pad"><h3 class="t">Searches with no results</h3>${m.zero_result_searches.length ? `<div class="chips">${m.zero_result_searches.map(q => `<span class="chip">${esc(q)}</span>`).join('')}</div>` : '<div class="small muted">None — good.</div>'}<div class="hint-t">These show what data or synonyms are missing.</div></div>
      <div class="card pad"><h3 class="t">What lawyers said</h3>${m.feedback.comments.map(c => `<div class="note small"><b>${c.rating > 0 ? '👍' : c.rating < 0 ? '👎' : '💬'} ${esc(c.kind)}</b> ${esc(c.comment)}</div>`).join('') || '<div class="small muted">No comments yet.</div>'}</div></div>` : ''}</div>`;
}

async function setData() {
  const [st, integ] = await Promise.all([api('/research/stats'), api('/integrations')]);
  const ok = b => `<span class="dot ${b ? 'on' : 'off'}"></span>${b ? 'Connected' : 'Not set up'}`;
  $('#stab').innerHTML = `<div class="grid g2"><div class="stack"><div class="card pad"><h3 class="t">Judgment library</h3>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px"><div class="card kpi" style="cursor:default"><div class="lbl">Judgments</div><div class="val">${fmtN(st.real_judgments || st.judgments)}</div><div class="hint">${st.fixture_only ? 'demo only' : 'real'}</div></div><div class="card kpi" style="cursor:default"><div class="lbl">Paragraphs</div><div class="val">${fmtN(st.paragraphs)}</div></div><div class="card kpi" style="cursor:default"><div class="lbl">Years</div><div class="val" style="font-size:24px">${st.year_min ? st.year_min + '–' + st.year_max : '—'}</div></div></div>
    ${st.courts.length ? `<table class="tbl">${st.courts.map(c => `<tr><td>${esc(c.court)}</td><td style="text-align:right;font-weight:600">${fmtN(c.count)}</td></tr>`).join('')}</table>` : ''}
    <div class="divider"></div><div class="small muted">Run in a terminal in the nyaai folder (safe to stop and re-run):</div>
    ${codeLine('python -m app.ingest sc --from-year 2015 --to-year 2024')}${codeLine('python -m app.ingest hc --list-courts')}${codeLine('python -m app.ingest hc --courts 27_1 --years 2024 2023')}
    ${codeLine('python -m app.ingest files "C:\\path\\to\\judgments"')}${codeLine('python -m app.ingest reindex')}${codeLine('python -m app.ingest embed')}
    <div class="small faint">Supreme Court and High Court judgments: AWS Open Data (CC-BY-4.0).</div></div></div>
  <div class="stack"><div class="card pad"><h3 class="t">Integrations</h3><dl class="kv" style="grid-template-columns:170px 1fr">
    <dt>Semantic search</dt><dd>${ok(integ.semantic_search.ready)} <span class="small faint">${fmtN(integ.semantic_search.vectors)} / ${fmtN(integ.semantic_search.paragraphs)} paragraphs</span></dd>
    <dt>eCourts sync</dt><dd>${ok(integ.ecourts)} <span class="small faint">ECOURTSINDIA_TOKEN</span></dd>
    <dt>Indian Kanoon check</dt><dd>${ok(integ.indiankanoon)} <span class="small faint">INDIANKANOON_TOKEN</span></dd>
    <dt>WhatsApp</dt><dd>${ok(integ.whatsapp)} <span class="small faint">WHATSAPP_TOKEN, …_PHONE_NUMBER_ID</span></dd></dl>
    <div class="small muted" style="margin-top:10px">Set these as environment variables before starting the server (see README). WhatsApp webhook URL: <code>${esc(location.origin)}/webhooks/whatsapp</code></div>
    ${integ.ecourts ? `<button class="btn" style="margin-top:12px" onclick="syncAll()">${I('clock')}Sync all matters from eCourts</button>` : ''}</div>
    <div class="card pad"><h3 class="t">Your data</h3><div class="small muted" style="margin-bottom:10px">Export everything your firm has stored (DPDP Act data portability). Erase a matter from its Edit dialog.</div>
      <div class="row">${isAdmin() ? `<button class="btn" onclick="exportFirm()">${I('download')}Export all data (JSON)</button><button class="btn" onclick="purgeCache()">Clear AI answer cache</button>` : '<span class="small muted">Ask an admin to export.</span>'}
      <button class="btn" onclick="seedDemo()">${I('plus')}Load demo matters</button></div></div>
    <div class="card pad"><h3 class="t">Keyboard</h3><dl class="kv"><dt><span class="kbd">Ctrl K</span> or <span class="kbd">/</span></dt><dd>Search everything</dd><dt><span class="kbd">Ctrl S</span></dt><dd>Save draft</dd><dt><span class="kbd">Esc</span></dt><dd>Close dialogs</dd></dl></div></div></div>`;
}
async function seedDemo() { const r = await api('/demo/seed', { json: {} }); toast(r.created_matters ? `${r.created_matters} demo matters added` : 'Demo matters are already loaded'); refreshCounts(); }
async function exportFirm() {
  const r = await api('/firm/export', { raw: true }); const b = await r.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = `nyaai-export-${TODAY}.json`; a.click(); toast('Export downloaded');
}
async function purgeCache() { const r = await api('/firm/purge-ai-cache', { json: {} }); toast(`${r.deleted} cached answers cleared`); }
async function syncAll() { toast('Syncing…'); const r = await api('/sync/all', { json: {} }); toast(`${r.synced} synced · ${r.new_orders} new orders · ${r.proposed_tasks} proposals`); refreshCounts(); }

/* feedback (used across views) */
function thumbs(kind, ref) {
  const id = 'fb' + Math.random().toString(36).slice(2, 8);
  return `<span class="thumbs" id="${id}"><button class="btn ghost sm" title="Helpful" onclick="sendFb('${id}','${kind}',${esc(JSON.stringify(ref || ''))},1)">👍</button><button class="btn ghost sm" title="Wrong or unhelpful" onclick="sendFb('${id}','${kind}',${esc(JSON.stringify(ref || ''))},-1)">👎</button></span>`;
}
async function sendFb(id, kind, ref, rating) {
  let comment = '';
  if (rating < 0) comment = prompt('What was wrong? (this goes to your firm admin and helps fix it)') || '';
  await api('/feedback', { json: { kind, ref: String(ref).slice(0, 300), rating, comment } });
  const el = document.getElementById(id); if (el) el.innerHTML = '<span class="small muted">Thanks</span>';
}
