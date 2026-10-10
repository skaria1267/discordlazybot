'use strict';

/* ================= 工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
const fmtMoney = (n) => (n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : (n || 0).toFixed(4));
const estTokens = (s) => { const cjk = (s.match(/[　-鿿＀-￯]/g) || []).length; return cjk + Math.round((s.length - cjk) / 4); };

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ago(ts) {
  if (!ts) return '从未';
  const s = Date.now() / 1000 - ts;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmtTime(ts);
}
function duration(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() / 1000 - ts) / 60);
  if (m < 60) return `${m} 分钟`;
  if (m < 1440) return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  return `${Math.floor(m / 1440)} 天 ${Math.floor((m % 1440) / 60)} 小时`;
}

const ICONS = {
  home: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6 10v9.5h4.5V14h3v5.5H18V10"/>',
  server: '<rect x="4" y="4.5" width="16" height="6.5" rx="2"/><rect x="4" y="13" width="16" height="6.5" rx="2"/><path d="M8 7.75h.01M8 16.25h.01"/>',
  log: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-2.5-1.6L13 20l-2.5-1.6L8 20l-2-1.3V5a1 1 0 0 1 1-1z"/><path d="M9.5 9h5M9.5 12.5h3.5"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chev: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 3.5 3.5"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 4h11v14H7a2 2 0 0 0-2 2z"/><path d="M5 20V5.5M9 8h6"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5"/>',
  hash: '<path d="M9.5 4 8 20M16 4l-1.5 16M5 9h14M4.5 15h14"/>',
  smile: '<circle cx="12" cy="12" r="8"/><path d="M9 14c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M9.5 10h.01M14.5 10h.01"/>',
  pen: '<path d="M5 19l1-4 9.5-9.5a2.1 2.1 0 0 1 3 3L9 18z"/><path d="M14 7l3 3"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="M10.5 12.5 19 4M16 7l2 2"/>',
  chat: '<path d="M5 6h14v10H10l-4 3.5V16H5z"/>',
  coin: '<ellipse cx="12" cy="7" rx="6.5" ry="2.5"/><path d="M5.5 7v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7M5.5 12v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5"/>',
  eye: '<path d="M3.5 12S6.5 6 12 6s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  spark: '<path d="M12 4l1.9 4.7L18.5 10l-4.6 1.4L12 16l-1.9-4.6L5.5 10l4.6-1.3z"/><path d="M18 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  trash: '<path d="M5.5 7h13M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  mail: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/>',
  sliders: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="18" cy="8" r="2"/>',
  download: '<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  logout: '<path d="M10 5H6v14h4M14 8l4 4-4 4M18 12H9"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, bad ? 4500 : 2000);
}

async function api(path, body, method) {
  const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('请先登录'); }
  let data = null;
  try { data = await res.json(); } catch (_) { /* 空响应 */ }
  if (!res.ok) throw new Error((data && data.detail) || `请求失败（${res.status}）`);
  return data;
}

async function run(btn, fn, okMsg) {
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); return undefined; }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}

const state = { timers: [], guilds: [], providers: null, modelLists: {}, sheets: [] };
function every(ms, fn) { fn(); state.timers.push(setInterval(fn, ms)); }
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

async function loadGuilds() {
  try { state.guilds = await api('/api/guilds'); } catch (_) { state.guilds = []; }
  return state.guilds;
}
async function loadProviders(force) {
  if (!state.providers || force) {
    try {
      state.providers = (await api('/api/providers')).providers;
      state.providers.forEach((p) => { state.modelLists[p.id] = p.model_list || []; });
    } catch (_) { state.providers = []; }
  }
  return state.providers;
}

/* ================= 组件 ================= */
function avatarHtml(url, name, cls = '') {
  if (url) return `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy">`;
  return `<span class="avatar ${cls}">${esc((name || '?').trim().slice(0, 1))}</span>`;
}
function emptyHtml(ic, text, actionHtml = '') {
  return `<div class="empty">${icon(ic)}<p>${text}</p>${actionHtml}</div>`;
}
function skeleton(n = 3) {
  return `<div class="sheet">${'<div class="skel"></div>'.repeat(n)}</div>`;
}

function switchRow(label, sub, checked, onChange, disabled = false) {
  const el = h(`<label class="switch-row"><div class="grow"><div>${esc(label)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>
    <span class="switch"><input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></span></label>`);
  el.querySelector('input').onchange = (e) => onChange(e.target.checked);
  return el;
}
function seg(options, value, onChange, { small = false, disabled = false } = {}) {
  const el = h(`<div class="seg ${small ? 'small' : ''}" role="tablist"></div>`);
  for (const [v, label] of options) {
    const b = h(`<button type="button" class="${v === value ? 'on' : ''}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`);
    b.onclick = () => { if (b.classList.contains('on')) return; $$('button', el).forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(v); };
    el.append(b);
  }
  return el;
}
function field(label, inner, help) {
  const el = h(`<div class="field"><span class="lab">${esc(label)}</span></div>`);
  if (typeof inner === 'string') el.insertAdjacentHTML('beforeend', inner); else el.append(inner);
  if (help) el.insertAdjacentHTML('beforeend', `<div class="help">${help}</div>`);
  return el;
}
function numberInput(value, onChange, { min, step, disabled } = {}) {
  const el = h(`<input type="number" inputmode="decimal" value="${esc(value ?? '')}" ${min !== undefined ? `min="${min}"` : ''} ${step ? `step="${step}"` : ''} ${disabled ? 'disabled' : ''}>`);
  el.oninput = () => onChange(el.value === '' ? null : Number(el.value));
  return el;
}
function textInput(value, onChange, { placeholder = '', type = 'text', list = '', disabled = false } = {}) {
  const el = h(`<input type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${list ? `list="${list}"` : ''} ${disabled ? 'disabled' : ''} autocomplete="off">`);
  el.oninput = () => onChange(el.value);
  return el;
}

// 原生下拉方便手机选填，文本框始终允许输入列表以外的模型名。
function modelInput(value, onChange, { providerId = '', disabled = false } = {}) {
  const box = h('<div class="model-picker"></div>');
  const input = textInput(value, onChange, { placeholder: '选择或填写模型名', disabled });
  input.setAttribute('aria-label', '模型名，可自行输入');
  const row = h('<div class="row"></div>');
  const select = h(`<select class="grow" aria-label="已拉取的模型" ${disabled ? 'disabled' : ''}></select>`);
  const button = h(`<button type="button" class="btn sm" ${disabled || !providerId ? 'disabled' : ''}>${icon('refresh')}拉取</button>`);
  const fill = () => {
    const models = state.modelLists[providerId] || [];
    select.innerHTML = `<option value="">${models.length ? `从 ${models.length} 个模型中选择` : '尚未拉取模型，可直接填写'}</option>` +
      models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    select.value = models.includes(input.value) ? input.value : '';
  };
  select.onchange = () => { if (select.value) { input.value = select.value; onChange(select.value); } };
  input.oninput = () => { onChange(input.value); select.value = (state.modelLists[providerId] || []).includes(input.value) ? input.value : ''; };
  button.onclick = (e) => run(e.currentTarget, async () => {
    const r = await api('/api/providers/models', { provider: { id: providerId } });
    if (!r.ok) throw new Error(r.error);
    state.modelLists[providerId] = r.models;
    if (state.providers) {
      const p = state.providers.find((x) => x.id === providerId);
      if (p) p.model_list = r.models;
    }
    fill();
    toast(`已拉取 ${r.models.length} 个模型`);
  });
  fill();
  row.append(select, button);
  box.append(input, row);
  return box;
}

/* 未保存便签 */
const SaveBar = {
  handler: null,
  show(count, onSave, onDiscard) {
    this.handler = { onSave, onDiscard };
    $('#savebarText').textContent = `有 ${count} 处改动还没保存`;
    $('#savebar').hidden = false;
  },
  hide() { this.handler = null; $('#savebar').hidden = true; },
  dirty() { return !!this.handler; },
};
$('#savebarSave').onclick = (e) => SaveBar.handler && run(e.currentTarget, SaveBar.handler.onSave, '已保存，立即生效');
$('#savebarDiscard').onclick = () => SaveBar.handler && SaveBar.handler.onDiscard();
window.addEventListener('beforeunload', (e) => { if (SaveBar.dirty()) { e.preventDefault(); e.returnValue = ''; } });

/* 表单草稿：跟踪改动数量 */
function makeForm(initial, { onSave, onDirty, onReset }) {
  const f = { orig: clone(initial), draft: clone(initial) };
  f.count = () => {
    const keys = new Set([...Object.keys(f.orig || {}), ...Object.keys(f.draft || {})]);
    let n = 0;
    keys.forEach((k) => { if (!same(f.orig[k], f.draft[k])) n++; });
    return n;
  };
  f.save = async () => { await onSave(f.draft); f.orig = clone(f.draft); f.changed(); };
  f.reset = () => { f.draft = clone(f.orig); f.changed(); if (onReset) onReset(); };
  f.changed = () => onDirty(f.count(), f);
  f.set = (k, v) => { f.draft[k] = v; f.changed(); };
  return f;
}
const barDirty = (n, f) => { if (n) SaveBar.show(n, f.save, f.reset); else SaveBar.hide(); };

/* 弹出面板 */
function openSheet({ title, body, foot, beforeClose, onClose, wide }) {
  const bg = h(`<div class="sheet-bg"><div class="panel" role="dialog" aria-modal="true">
    <div class="panel-head"><h2>${title}</h2><button class="icon-btn" aria-label="关闭">${icon('close')}</button></div>
    <div class="panel-body"></div></div></div>`);
  const panel = bg.querySelector('.panel');
  if (wide) panel.style.maxWidth = '760px';
  const bodyEl = bg.querySelector('.panel-body');
  if (body) bodyEl.append(body);
  let footEl = null;
  if (foot) { footEl = h('<div class="panel-foot"></div>'); footEl.append(...[].concat(foot)); panel.append(footEl); }
  const s = {
    el: bg, body: bodyEl, foot: footEl,
    close(force) {
      if (!force && beforeClose && beforeClose() === false) return;
      bg.remove(); state.sheets = state.sheets.filter((x) => x !== s); if (onClose) onClose();
    },
    setTitle(t) { bg.querySelector('h2').innerHTML = t; },
  };
  bg.querySelector('.icon-btn').onclick = () => s.close();
  bg.addEventListener('click', (e) => { if (e.target === bg) s.close(); });
  document.body.append(bg);
  state.sheets.push(s);
  return s;
}
const confirmLeave = () => confirm('有改动还没保存，确定放弃吗？');

/* ================= 路由 ================= */
const ROUTES = [
  [/^#\/overview$/, () => pageOverview],
  [/^#\/servers$/, () => pageServers],
  [/^#\/server\/(\d+)(?:\/(\w+))?$/, () => pageServer],
  [/^#\/logs$/, () => pageLogs],
  [/^#\/settings$/, () => pageSettings],
  [/^#\/settings\/(\w+)$/, () => pageSettingsSub],
];
let currentHash = '';
let reverting = false;

window.addEventListener('hashchange', () => {
  if (reverting) { reverting = false; return; }
  if (SaveBar.dirty() && !confirmLeave()) { reverting = true; location.hash = currentHash; return; }
  SaveBar.hide();
  render();
});

function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

async function render() {
  const hash = location.hash || '#/overview';
  currentHash = hash;
  clearTimers();
  state.sheets.slice().forEach((s) => s.close(true));
  const top = hash.split('/')[1] || 'overview';
  const navKey = top === 'server' ? 'servers' : top;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  const main = $('#main');
  for (const [re, getPage] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      main.innerHTML = skeleton(4);
      window.scrollTo(0, 0);
      try { await getPage()(main, ...m.slice(1)); }
      catch (e) { if (e.message !== '请先登录') main.innerHTML = `<div class="sheet">${emptyHtml('log', esc(e.message))}</div>`; }
      return;
    }
  }
  go('#/overview');
}

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = [['overview', 'home', '概览'], ['servers', 'server', '服务器'], ['logs', 'log', '日志'], ['settings', 'gear', '设置']]
    .map(([k, ic, label]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}<span>${label}</span></a>`).join('');
  nav.hidden = false;
}

function pageHead(title, sub = '', backHref = '', backLabel = '') {
  return `${backHref ? `<a class="back" href="${backHref}">${icon('back')}${esc(backLabel)}</a>` : ''}
    <div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`;
}

/* ================= 登录 ================= */
function showLogin() {
  clearTimers();
  SaveBar.hide();
  state.sheets.slice().forEach((s) => s.close(true));
  $('#nav').hidden = true;
  const main = $('#main');
  main.innerHTML = `<div class="login"><div class="sheet">
    <h1>LazyBot</h1><p class="muted" style="margin:0 0 18px">管理后台</p>
    <div class="field"><span class="lab">密码</span><input type="password" id="pw" autocomplete="current-password"></div>
    <button class="btn ink block" id="loginBtn">登录</button></div></div>`;
  const doLogin = () => run($('#loginBtn'), async () => {
    await api('/api/login', { password: $('#pw').value });
    start();
  });
  $('#loginBtn').onclick = doLogin;
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#pw').focus();
}

async function start() {
  renderNav();
  await loadGuilds();
  if (!location.hash || location.hash === '#') location.hash = '#/overview';
  else render();
}

/* ================= 概览 ================= */
const STATE_TEXT = { online: '在线', connecting: '连接中', stopped: '离线', error: '出错' };

async function pageOverview(main) {
  const d = await api('/api/overview');
  const s = d.status;
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];
  const now = new Date();
  main.innerHTML = pageHead('今天', `${now.getMonth() + 1}月${now.getDate()}日 星期${wd}`);

  // 证件照
  const id = h(`<div class="sheet"><div class="polaroid">
    <div class="photo">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : `<div class="ph">${icon('user')}</div>`}</div>
    <div class="who grow"><h2>${esc(s.user ? s.user.replace(/#0$/, '') : '还没连上 Discord')}</h2>
      <div class="small muted">${s.state === 'online' ? `延迟 ${s.latency_ms ?? '-'} ms · 已连接 ${duration(s.connected_at)}` : (s.error ? esc(s.error) : '在「设置 › 机器人连接」里填写 token')}</div>
      ${s.state === 'online' && (s.queues || s.busy_channels) ? `<div class="small muted">正在处理 ${s.busy_channels} 个频道，排队 ${s.queues} 条</div>` : ''}</div>
    <div class="stamp ${s.state}">${STATE_TEXT[s.state] || s.state}</div></div></div>`);
  main.append(id);

  // 起步清单
  const st = d.setup;
  if (!(st.token && st.online && st.guilds && st.model && st.persona)) {
    const items = [
      [st.token && st.online, '填写 bot token 并连上 Discord', '#/settings/bot'],
      [st.guilds, '邀请 bot 加入服务器', s.invite_url || '#/settings/bot', !!s.invite_url],
      [st.model, '配置聊天用的模型', '#/settings/api'],
      [st.persona, '写一份默认人设', '#/settings/persona'],
    ];
    main.append(h(`<div class="sheet"><h3 class="tape pink">还差几步</h3><ul class="todo">
      ${items.map(([done, label, href, ext]) => `<li class="${done ? 'done' : ''}"><a href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ''}>
        <span class="box">${done ? icon('check') : ''}</span><span class="label grow">${label}</span>${done ? '' : `<span class="chev" style="width:18px;color:var(--ink-faint)">${icon('chev')}</span>`}</a></li>`).join('')}
    </ul></div>`));
  }

  // 今天
  const received = d.guilds.reduce((a, g) => a + g.today - g.replies_today, 0);
  const replies = d.guilds.reduce((a, g) => a + g.replies_today, 0);
  const maxTok = Math.max(1, ...d.week.map((x) => x.tokens));
  const today = h(`<div class="sheet">
    <div class="sheet-head"><h3 class="tape blue">今天的账</h3><a class="btn ghost sm" href="#/settings/usage">用量账本 ${icon('chev')}</a></div>
    <div class="trio">
      <div><b>${fmtNum(received)}</b><span>收到消息</span></div>
      <div><b>${fmtNum(replies)}</b><span>bot 发言</span></div>
      <div><b>${d.has_prices ? fmtMoney(d.today.cost) : '–'}</b><span>${d.has_prices ? '花费' : '未设单价'}</span></div>
    </div>
    <div class="bars">${d.week.map((x, i) => `<span class="${i === d.week.length - 1 ? 'today' : ''}" style="height:${Math.max(3, (x.tokens / maxTok) * 100)}%" title="${x.key}：${fmtNum(x.tokens)} tokens"></span>`).join('')}</div>
    <div class="bar-labels">${d.week.map((x, i) => `<span>${i === d.week.length - 1 ? '今天' : x.key.slice(3)}</span>`).join('')}</div>
    <p class="hint" style="text-align:center">最近 7 天每天用掉的 tokens${d.today.fails ? ` · 今天有 <span class="mark">${d.today.fails} 次调用失败</span>` : ''}</p>
  </div>`);
  main.append(today);

  // 服务器
  const sv = h(`<div class="sheet"><div class="sheet-head"><h3 class="tape green">服务器</h3><a class="btn ghost sm" href="#/servers">全部 ${icon('chev')}</a></div><div class="list"></div></div>`);
  const list = sv.querySelector('.list');
  if (!d.guilds.length) {
    list.innerHTML = emptyHtml('server', 'bot 还没有加入任何服务器', s.invite_url ? `<a class="btn ink" href="${esc(s.invite_url)}" target="_blank" rel="noopener">${icon('link')}邀请进服务器</a>` : '');
  } else {
    list.innerHTML = d.guilds.map((g) => `<a class="item" href="#/server/${g.id}">
      ${avatarHtml(g.icon, g.name, 'square')}
      <div class="grow"><div class="t">${esc(g.name)}</div>
        <div class="s">今天 ${g.today} 条消息 · 记忆${g.memory_updated ? ` ${ago(g.memory_updated)}更新` : '还没写'}${g.new_since ? `，之后新增 ${g.new_since} 条` : ''}</div></div>
      ${g.new_since >= 300 ? '<span class="badge yellow">该总结了</span>' : ''}<span class="chev">${icon('chev')}</span></a>`).join('');
  }
  main.append(sv);

  if (d.errors.length) {
    main.append(h(`<div class="sheet"><div class="sheet-head"><h3 class="tape red">最近的报错</h3><a class="btn ghost sm" href="#/logs">日志 ${icon('chev')}</a></div>
      <div class="list">${d.errors.map((e) => `<div class="item"><div class="grow"><div class="t small">${esc(e.message)}</div><div class="s">${fmtTime(e.ts)} · ${esc(e.logger)}</div></div></div>`).join('')}</div></div>`));
  }
}

/* ================= 服务器列表 ================= */
async function pageServers(main) {
  await loadGuilds();
  const joined = state.guilds.filter((g) => g.joined);
  const left = state.guilds.filter((g) => !g.joined);
  main.innerHTML = pageHead('服务器', joined.length ? `bot 在 ${joined.length} 个服务器里` : '');
  if (!joined.length) {
    main.append(h(`<div class="sheet">${emptyHtml('server', 'bot 还没有加入任何服务器', `<a class="btn ink" href="#/settings/bot">${icon('link')}去拿邀请链接</a>`)}</div>`));
  }
  for (const g of joined) {
    main.append(h(`<a class="sheet link" href="#/server/${g.id}"><div class="row">
      ${avatarHtml(g.icon, g.name, 'square lg')}
      <div class="grow"><div style="font-size:18px;line-height:1.35">${esc(g.name)}</div>
      <div class="small muted">${fmtNum(g.member_count)} 位成员 · ${g.channels.length} 个频道 · 存了 ${fmtNum(g.message_count)} 条消息</div></div>
      <span class="chev" style="width:20px;color:var(--ink-faint)">${icon('chev')}</span></div></a>`));
  }
  if (left.length) {
    main.append(h(`<details class="sheet flat"><summary>已离开的服务器（${left.length}）</summary><div class="list">
      ${left.map((g) => `<a class="item" href="#/server/${g.id}">${avatarHtml(g.icon, g.name, 'square')}<div class="grow"><div class="t">${esc(g.name)}</div><div class="s">记忆和消息记录仍然保留</div></div></a>`).join('')}</div></details>`));
  }
}

/* ================= 单个服务器 ================= */
const SERVER_TABS = [['persona', '人设'], ['memory', '记忆'], ['members', '群友'], ['channels', '频道'], ['emoji', '表情']];

async function pageServer(main, gid, tab) {
  tab = tab || 'persona';
  if (!state.guilds.find((g) => g.id === gid)) await loadGuilds();
  const g = state.guilds.find((x) => x.id === gid);
  if (!g) { main.innerHTML = `<div class="sheet">${emptyHtml('server', '找不到这个服务器')}</div>`; return; }
  main.innerHTML = `<a class="back" href="#/servers">${icon('back')}服务器</a>
    <div class="server-head">${avatarHtml(g.icon, g.name, 'square lg')}<div class="grow"><h1>${esc(g.name)}</h1>
    <div class="small muted">${fmtNum(g.member_count)} 位成员${g.joined ? '' : ' · bot 已离开'}</div></div></div>`;
  const sub = h('<div class="subnav"></div>');
  sub.append(seg(SERVER_TABS, tab, (v) => { location.hash = `#/server/${gid}/${v}`; }, { small: true }));
  main.append(sub);
  const body = h('<div></div>');
  main.append(body);
  body.innerHTML = skeleton(3);
  const pages = { persona: serverPersona, memory: serverMemory, members: serverMembers, channels: serverChannels, emoji: serverEmoji };
  await (pages[tab] || serverPersona)(body, g);
}

/* ---------- 分层配置编辑器 ---------- */
const PRESETS = {
  quiet: { interject_prob: 0.05, interject_cooldown: 900, interject_max: 2, interject_window: 60 },
  normal: { interject_prob: 0.15, interject_cooldown: 300, interject_max: 5, interject_window: 60 },
  chatty: { interject_prob: 0.4, interject_cooldown: 90, interject_max: 12, interject_window: 60 },
};
const CFG_SECTIONS = [
  { id: 'persona', title: '人设', tape: 'pink', keys: ['persona'] },
  { id: 'reply', title: '回复与上下文', tape: 'blue', keys: ['enabled', 'reply_enabled', 'context_mode', 'context_size', 'image_limit', 'reply_image_limit', 'memory_enabled'] },
  { id: 'emoji', title: '表情', tape: 'yellow', keys: ['emoji_scope', 'emoji_limit', 'emoji_images', 'emoji_image_limit'] },
  { id: 'interject', title: '主动插话', tape: 'yellow', keys: ['interject_enabled', 'interject_prob', 'interject_cooldown', 'interject_max', 'interject_window'] },
  { id: 'model', title: '聊天模型与联网', tape: 'green', keys: ['chat_provider', 'chat_model', 'chat_tools', 'chat_tool_rounds'] },
];

/**
 * scopeType: global | guild | channel
 * opts: { parentName, guildId, channelId, onDirty, sections }
 * 返回 form（可调用 form.save）
 */
async function configEditor(box, scopeType, scopeId, opts = {}) {
  const res = await api(`/api/config?scope_type=${scopeType}&scope_id=${scopeId}`);
  const providers = await loadProviders();
  const isGlobal = scopeType === 'global';
  const sections = opts.sections ? CFG_SECTIONS.filter((s) => opts.sections.includes(s.id)) : CFG_SECTIONS;
  const form = makeForm(res.data || {}, {
    onSave: (draft) => api('/api/config', { scope_type: scopeType, scope_id: scopeId, data: draft }),
    onDirty: opts.onDirty || barDirty,
    onReset: () => draw(),
  });
  const base = isGlobal ? res.defaults : res.parent;
  const isCustom = (sec) => isGlobal || sec.keys.some((k) => k in form.draft);
  const val = (k) => (k in form.draft ? form.draft[k] : base[k]);

  function draw() {
    box.innerHTML = '';
    for (const sec of sections) {
      const custom = isCustom(sec);
      const card = h(`<div class="sheet"><div class="sheet-head"><h3 class="tape ${sec.tape}">${sec.title}</h3></div>
        ${!isGlobal && !custom ? `<div class="inherit-note">正在沿用${opts.parentName || '上层'}的设置</div>` : ''}<div class="section-body ${custom ? '' : 'following'}"></div></div>`);
      if (!isGlobal) {
        const toggle = seg([['follow', `跟随${opts.parentName || '上层'}`], ['custom', '单独设置']], custom ? 'custom' : 'follow', (v) => {
          if (v === 'custom') sec.keys.forEach((k) => { form.draft[k] = clone(base[k]); });
          else sec.keys.forEach((k) => { delete form.draft[k]; });
          form.changed();
          draw();
        }, { small: true });
        card.querySelector('.sheet-head').append(toggle);
      }
      const body = card.querySelector('.section-body');
      const dis = !custom;
      SECTION_RENDER[sec.id](body, { val, set: (k, v) => form.set(k, v), dis, providers, opts, redraw: draw });
      if (sec.id === 'reply' && !isGlobal && opts.guildId) {
        // 上下文起点立即生效，不受「跟随上层」影响，所以放在分区内容之外
        const g = state.guilds.find((x) => x.id === opts.guildId);
        card.append(h('<hr class="hr">'));
        card.append(contextStartBlock({
          guildId: opts.guildId,
          channelId: scopeType === 'channel' ? scopeId : '',
          channels: g ? g.channels.filter((c) => c.type !== 'category') : [],
        }));
      }
      box.append(card);
    }
  }
  draw();
  return form;
}

const SECTION_RENDER = {
  persona(body, { val, set, dis, opts }) {
    const ta = h(`<textarea class="paper" ${dis ? 'disabled' : ''} placeholder="写下 bot 是谁、怎么说话、有什么喜好和禁忌…">${esc(val('persona'))}</textarea>`);
    const meta = h(`<div class="row small muted" style="margin-top:8px"><span class="grow count"></span></div>`);
    const upd = () => { meta.querySelector('.count').textContent = `${ta.value.length} 字 · 约 ${estTokens(ta.value)} tokens`; };
    ta.oninput = () => { set('persona', ta.value); upd(); };
    upd();
    const pv = h(`<button class="btn sm">${icon('eye')}预览完整提示词</button>`);
    pv.onclick = () => openPreview(opts.guildId || '', opts.channelId || '');
    meta.append(pv);
    body.append(ta, meta);
  },
  reply(body, { val, set, dis }) {
    body.append(switchRow('在这里启用 bot', '关闭后在这里既不回复也不插话', val('enabled'), (v) => set('enabled', v), dis));
    body.append(switchRow('被 @ 或被回复时回答', '', val('reply_enabled'), (v) => set('reply_enabled', v), dis));
    body.append(switchRow('加载记忆', '把服务器记忆和群友记忆放进提示词', val('memory_enabled'), (v) => set('memory_enabled', v), dis));
    body.append(h('<hr class="hr">'));
    const sizeWrap = h('<div></div>');
    const drawSize = () => {
      const tokens = val('context_mode') === 'tokens';
      sizeWrap.innerHTML = '';
      sizeWrap.append(field(tokens ? '上下文最多多少 tokens（估算）' : '带上最近多少条消息', numberInput(val('context_size'), (v) => set('context_size', v), { min: 1, disabled: dis })));
    };
    body.append(field('上下文按什么算', seg([['count', '按消息条数'], ['tokens', '按 token 数']], val('context_mode'), (v) => { set('context_mode', v); drawSize(); }, { disabled: dis })));
    drawSize();
    body.append(sizeWrap);
    body.append(field('最多带几张图片', numberInput(val('image_limit'), (v) => set('image_limit', v), { min: 0, disabled: dis }), '只取最近的几张，设为 0 则不看图'));
    body.append(field('被回复的消息里最多看几张图', numberInput(val('reply_image_limit'), (v) => set('reply_image_limit', v), { min: 0, disabled: dis }), '有人回复一条带图的消息来找 bot 时，把那条消息里的图也给它看，不占上面的名额；设为 0 则不看'));
  },
  emoji(body, { val, set, dis }) {
    body.append(field('用哪些表情', seg([['guild', '只用本服务器的'], ['all', 'bot 所在所有服务器的']], val('emoji_scope'), (v) => set('emoji_scope', v), { disabled: dis }),
      '选所有服务器时本服务器的优先；用别的服务器的表情需要 bot 在频道里有「使用外部表情」权限'));
    body.append(field('最多给模型看多少个表情', numberInput(val('emoji_limit'), (v) => set('emoji_limit', v), { min: 0, disabled: dis }),
      '表情多于这个数时按常用程度挑选，挑选结果一天更新一次，避免频繁变动影响提示词缓存；设为 0 则不用表情'));
    body.append(h('<hr class="hr">'));
    body.append(switchRow('让 bot 看到群友用的表情长什么样', '上下文里的服务器表情附上小图，不占「最多带几张图片」的名额；同一个表情只附一次', val('emoji_images'), (v) => set('emoji_images', v), dis));
    body.append(field('表情图片最多几张', numberInput(val('emoji_image_limit'), (v) => set('emoji_image_limit', v), { min: 0, disabled: dis }),
      '一次请求里最多附几张不同的表情图，0 为不限。Claude 接口一次最多 100 张图（含普通图片），超了会报错'));
  },
  interject(body, { val, set, dis, redraw }) {
    body.append(switchRow('允许主动插话', '没人叫它时，偶尔自己接话或点个表情', val('interject_enabled'), (v) => set('interject_enabled', v), dis));
    const current = Object.entries(PRESETS).find(([, p]) => Object.entries(p).every(([k, v]) => Number(val(k)) === v));
    const presetKey = current ? current[0] : 'custom';
    body.append(field('话多话少', seg([['quiet', '安静'], ['normal', '适中'], ['chatty', '话痨'], ['custom', '自定义']], presetKey, (v) => {
      if (PRESETS[v]) { Object.entries(PRESETS[v]).forEach(([k, x]) => set(k, x)); redraw(); }
      else { adv.open = true; }
    }, { disabled: dis })));
    const prob = Number(val('interject_prob') || 0);
    const summary = h(`<p class="hint"></p>`);
    const sumText = () => {
      const p = Number(val('interject_prob') || 0);
      summary.innerHTML = `每批新消息有 <span class="mark">${Math.round(p * 100)}%</span> 的概率去判断要不要说话${p > 0 ? `（大约每 ${Math.max(1, Math.round(1 / p))} 批一次）` : ''}，自己说完话后至少隔 ${val('interject_cooldown')} 秒，每 ${val('interject_window')} 分钟最多 ${val('interject_max')} 次。`;
    };
    sumText();
    body.append(summary);
    const adv = h(`<details ${presetKey === 'custom' ? 'open' : ''}><summary>细调参数</summary><div style="padding-top:8px"></div></details>`);
    const inner = adv.querySelector('div');
    const range = h(`<input type="range" min="0" max="1" step="0.01" value="${prob}" ${dis ? 'disabled' : ''}>`);
    range.oninput = () => { set('interject_prob', Number(range.value)); sumText(); };
    inner.append(field('判断概率', range));
    inner.append(field('冷却时间（秒）', numberInput(val('interject_cooldown'), (v) => { set('interject_cooldown', v); sumText(); }, { min: 0, disabled: dis })));
    const row = h('<div class="row"></div>');
    const a = field('统计窗口（分钟）', numberInput(val('interject_window'), (v) => { set('interject_window', v); sumText(); }, { min: 1, disabled: dis }));
    const b = field('窗口内最多次数', numberInput(val('interject_max'), (v) => { set('interject_max', v); sumText(); }, { min: 0, disabled: dis }));
    a.classList.add('grow'); b.classList.add('grow');
    row.append(a, b);
    inner.append(row);
    body.append(adv);
  },
  model(body, { val, set, dis, providers }) {
    const sel = h(`<select ${dis ? 'disabled' : ''}><option value="">使用「接口与模型」里的聊天模型</option>
      ${providers.map((p) => `<option value="${p.id}" ${p.id === val('chat_provider') ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`);
    const wrap = h('<div></div>');
    const fillModel = () => {
      wrap.replaceChildren(field('模型名', modelInput(val('chat_model'), (v) => set('chat_model', v),
        { providerId: sel.value, disabled: dis }), '可选择拉取的模型，也可直接填写名字；留空沿用默认聊天模型'));
    };
    sel.onchange = () => { set('chat_provider', sel.value); fillModel(); };
    fillModel();
    body.append(field('供应商', sel));
    body.append(wrap);
    const mode = h(`<select ${dis ? 'disabled' : ''}><option value="off">纯聊天</option><option value="external">工具调用 + 搜索服务</option><option value="claude">Claude 原生联网搜索</option></select>`);
    mode.value = val('chat_tools') || 'off';
    mode.onchange = () => set('chat_tools', mode.value);
    body.append(field('联网方式', mode, '搜索服务模式支持 OpenAI 兼容与 Claude；请先在「设置 → 联网搜索」配置服务。原生搜索需要 Claude 格式及供应商支持。'));
    body.append(field('最多工具调用轮数', numberInput(val('chat_tool_rounds') || 4, (v) => set('chat_tool_rounds', v), { min: 1, disabled: dis }), '1–8 轮，仅影响聊天回复；缓存断点由反代处理'));
  },
};

async function openPreview(guildId, channelId) {
  const body = h(`<div>${skeleton(5)}</div>`);
  openSheet({ title: '实际发给模型的内容', body, wide: true });
  try {
    const p = await api(`/api/preview?guild_id=${guildId}&channel_id=${channelId}`);
    body.innerHTML = `<p class="small muted" style="margin-top:0">按已保存的设置拼出，bot 下一次在${p.channel ? ` #${esc(p.channel)}` : '这里'}回复时，大概会发送：
      系统提示词约 <span class="mark">${fmtNum(p.system_tokens)}</span> tokens，上下文约 <span class="mark">${fmtNum(p.context_tokens)}</span> tokens${p.images ? `，外加 ${p.images} 张图片` : ''}。</p>`;
    const view = h('<div></div>');
    const show = (v) => {
      view.innerHTML = v === 'system' ? `<div class="prompt">${esc(p.system)}</div>`
        : (p.messages.length ? p.messages.map((m) => `<div class="turn ${m.role}"><b>${m.role === 'user' ? '群友' : 'bot'}</b>${esc(m.text)}</div>`).join('') : emptyHtml('chat', '这里还没有聊天记录'));
    };
    const s = seg([['system', '系统提示词'], ['context', '聊天上下文']], 'system', show, { small: true });
    s.style.marginBottom = '12px';
    body.append(s, view);
    show('system');
  } catch (e) { body.innerHTML = emptyHtml('log', esc(e.message)); }
}

async function serverPersona(body, g) {
  body.innerHTML = '';
  // 表情相关设置放在「表情」页
  const sections = CFG_SECTIONS.map((s) => s.id).filter((id) => id !== 'emoji');
  await configEditor(body, 'guild', g.id, { parentName: '全局', guildId: g.id, sections });
  body.append(h(`<p class="hint" style="text-align:center">全局默认值在「设置 › 默认人设」里修改。单个频道的设置在「频道」里。</p>`));
}

/* ---------- 记忆 ---------- */
async function serverMemory(body, g) {
  body.innerHTML = '';
  const gcard = h(`<div class="sheet"></div>`);
  body.append(gcard);
  await memoryCard(gcard, 'guild', g.id, '', '服务器记忆');

  const people = h(`<div class="sheet"><h3 class="tape green">群友记忆</h3>
    <input type="search" placeholder="搜索昵称、用户名或 ID"><div class="list" style="margin-top:8px"></div></div>`);
  body.append(people);
  const list = people.querySelector('.list');
  const load = async () => {
    const q = people.querySelector('input').value.trim();
    const rows = await api(`/api/guilds/${g.id}/members?q=${encodeURIComponent(q)}`);
    const sorted = rows.filter((m) => !m.is_bot).sort((a, b) => (b.memory_id ? 1 : 0) - (a.memory_id ? 1 : 0) || b.msgs - a.msgs);
    list.innerHTML = sorted.slice(0, q ? 80 : 30).map((m) => memberItem(m, true)).join('') || emptyHtml('user', '没有找到群友');
    $$('[data-uid]', list).forEach((el) => {
      el.onclick = () => {
        const m = sorted.find((x) => x.user_id === el.dataset.uid);
        openMemorySheet('user', g.id, m.user_id, esc(displayName(m)), load);
      };
    });
  };
  let t;
  people.querySelector('input').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  await load();
}

const displayName = (m) => m.nick || m.global_name || m.username || m.user_id;
function memberItem(m, showMemory) {
  const extra = [`@${esc(m.username)}`, `${m.msgs} 条消息`];
  if (m.former && m.former.length) extra.push(`曾用名 ${esc(m.former.join('、'))}`);
  return `<button class="item" data-uid="${m.user_id}">${avatarHtml(m.avatar, displayName(m))}
    <div class="grow"><div class="t">${esc(displayName(m))}</div><div class="s">${extra.join(' · ')}</div></div>
    ${m.is_bot ? '<span class="badge">bot</span>' : ''}${m.in_guild ? '' : '<span class="badge">已退出</span>'}
    ${showMemory && m.memory_id ? '<span class="badge green">有记忆</span>' : ''}<span class="chev">${icon('chev')}</span></button>`;
}

async function memoryCard(card, scope, gid, uid, title) {
  const info = await api(`/api/memory/get?scope=${scope}&guild_id=${gid}&user_id=${uid}`);
  const m = info.memory;
  card.innerHTML = `<div class="sheet-head"><h3 class="tape green">${title}</h3></div>
    ${m && m.content.trim() ? `<div class="clamp">${esc(m.content)}</div>` : '<p class="muted" style="margin:0">还没有记忆。可以从聊天记录里总结一份，也可以直接手写。</p>'}
    <p class="hint">${m ? `${ago(m.updated_at)}更新 · ` : ''}${info.summarized_until ? `上次总结到 ${fmtTime(info.summarized_until)}，之后新增 ${info.new_since} 条消息` : `共有 ${info.new_since} 条消息可以总结`}
    ${gid !== 'dm' ? ` · <a href="#/server/${gid}/channels">消息不全？导入历史</a>` : ''}</p>
    <div class="actions"><button class="btn" data-a="edit">${icon('pen')}${m ? '编辑' : '手写'}</button><button class="btn ink" data-a="sum">${icon('spark')}总结</button></div>`;
  const refresh = () => memoryCard(card, scope, gid, uid, title);
  card.querySelector('[data-a=edit]').onclick = () => openMemorySheet(scope, gid, uid, title, refresh);
  card.querySelector('[data-a=sum]').onclick = () => openSummarize(scope, gid, uid, info, title, refresh);
}

async function openMemorySheet(scope, gid, uid, title, onChange) {
  const info = await api(`/api/memory/get?scope=${scope}&guild_id=${gid}&user_id=${uid}`);
  let mem = info.memory;
  let saved = mem ? mem.content : '';
  const body = h(`<div>
    ${info.tag ? `<p class="small muted" style="margin:0 0 8px">${esc(info.tag)}</p>` : ''}
    <textarea class="paper fill" placeholder="一行一条，写下值得长期记住的事">${esc(saved)}</textarea>
    <p class="hint meta"></p></div>`);
  const ta = body.querySelector('textarea');
  const meta = () => { body.querySelector('.meta').textContent = `${ta.value.length} 字 · 约 ${estTokens(ta.value)} tokens${mem ? ` · ${ago(mem.updated_at)}更新` : ''}`; };
  meta();
  ta.oninput = meta;
  const hist = h(`<button class="btn ghost">${icon('clock')}历史</button>`);
  const sum = h(`<button class="btn">${icon('spark')}总结</button>`);
  const save = h(`<button class="btn ink">保存</button>`);
  const sheet = openSheet({
    title: `${title} 的记忆`, body, foot: [hist, h('<span class="grow"></span>'), sum, save],
    beforeClose: () => ta.value === saved || confirmLeave(),
  });
  save.onclick = () => run(save, async () => {
    mem = (await api('/api/memory/save', { scope, guild_id: gid, user_id: uid, content: ta.value, note: '手动修改' })).memory;
    saved = ta.value; meta(); if (onChange) onChange();
  }, '记忆已保存');
  hist.onclick = () => { if (!mem) { toast('还没有保存过'); return; } openHistory(mem, (m) => { mem = m; saved = m.content; ta.value = m.content; meta(); if (onChange) onChange(); }); };
  sum.onclick = () => openSummarize(scope, gid, uid, info, title, async () => {
    const fresh = await api(`/api/memory/get?scope=${scope}&guild_id=${gid}&user_id=${uid}`);
    mem = fresh.memory; saved = mem ? mem.content : ''; ta.value = saved; meta(); if (onChange) onChange();
  });
  return sheet;
}

function openSummarize(scope, gid, uid, info, title, onDone) {
  const g = state.guilds.find((x) => x.id === gid);
  const now = Date.now() / 1000;
  const since = info.summarized_until;
  const st = { range: since ? 'since' : 'all', channels: [], mode: 'merge', start: null, end: null };
  const body = h('<div></div>');
  const foot = h(`<button class="btn ink">${icon('spark')}开始总结</button>`);
  const sheet = openSheet({ title: `总结${title}`, body, foot: [foot], beforeClose: () => !st.running || confirm('总结还在进行，关掉后结果会丢失，确定吗？') });

  const ranges = [[since ? 'since' : 'all', since ? '上次总结以后' : '全部消息'], ['day', '最近 24 小时'], ['week', '最近 7 天'], ['custom', '自定义']];
  const calc = () => {
    if (st.range === 'since') return [since, null];
    if (st.range === 'day') return [now - 86400, null];
    if (st.range === 'week') return [now - 7 * 86400, null];
    if (st.range === 'custom') return [st.start, st.end];
    return [null, null];
  };
  const payload = () => { const [start, end] = calc(); return { scope, guild_id: gid, user_id: uid, channel_ids: st.channels, start, end, mode: st.mode }; };

  function step1() {
    body.innerHTML = '';
    const rangeChips = h('<div class="chips"></div>');
    ranges.forEach(([v, l]) => {
      const c = h(`<button class="chip ${st.range === v ? 'on' : ''}">${l}</button>`);
      c.onclick = () => { st.range = v; step1(); };
      rangeChips.append(c);
    });
    body.append(field('总结哪段时间的消息', rangeChips));
    if (st.range === 'custom') {
      if (st.start == null && st.end == null) { st.start = Math.floor(now - 7 * 86400); st.end = Math.floor(now); }
      const toLocal = (ts) => {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      const wrap = h(`<div class="field"><div class="row">
        <div class="grow"><span class="lab">从</span><input type="datetime-local" data-k="start" value="${toLocal(st.start)}"></div>
        <div class="grow"><span class="lab">到</span><input type="datetime-local" data-k="end" value="${toLocal(st.end)}"></div></div>
        <div class="help">留空表示不限制</div></div>`);
      $$('input', wrap).forEach((inp) => { inp.onchange = () => { st[inp.dataset.k] = inp.value ? new Date(inp.value).getTime() / 1000 : null; count(); }; });
      body.append(wrap);
    }
    if (g && g.channels.length) {
      const chips = h('<div class="chips"></div>');
      const all = h(`<button class="chip ${st.channels.length ? '' : 'on'}">全部频道</button>`);
      all.onclick = () => { st.channels = []; step1(); };
      chips.append(all);
      g.channels.filter((c) => c.type === 'text' || c.type === 'voice' || c.type === 'forum').forEach((c) => {
        const on = st.channels.includes(c.id);
        const el = h(`<button class="chip ${on ? 'on' : ''}">#${esc(c.name)}</button>`);
        el.onclick = () => { st.channels = on ? st.channels.filter((x) => x !== c.id) : [...st.channels, c.id]; step1(); };
        chips.append(el);
      });
      body.append(field('哪些频道', chips));
    }
    body.append(field('怎么写进去', seg([['merge', '合并到现有记忆'], ['replace', '重新写一份']], st.mode, (v) => { st.mode = v; }), st.mode === 'merge' ? '保留仍然有效的旧内容，补充新信息' : '忽略现有记忆，只根据这段消息重写'));
    body.append(h('<p class="hint cnt">正在统计…</p>'));
    count();
  }
  let cTimer;
  function count() {
    clearTimeout(cTimer);
    cTimer = setTimeout(async () => {
      try {
        const r = await api('/api/memory/count', payload());
        const el = $('.cnt', body);
        if (el) el.innerHTML = `将读取 <span class="mark">${r.total}</span> 条消息${r.user !== undefined ? `，其中 TA 说了 ${r.user} 条` : ''}。`
          + (gid !== 'dm' ? `<br>只能总结 bot 已经存下来的消息，更早的聊天记录要先到「频道」页导入。` : '');
        foot.disabled = !r.total;
      } catch (e) { const el = $('.cnt', body); if (el) el.textContent = e.message; }
    }, 250);
  }

  foot.onclick = async () => {
    st.running = true;
    foot.disabled = true;
    body.innerHTML = `<div style="padding:20px 0"><p style="margin:0 0 10px">正在读聊天记录…</p><div class="progress"><i></i></div><p class="hint step"></p></div>`;
    try {
      const { job_id } = await api('/api/memory/summarize', payload());
      let j;
      for (;;) {
        await sleep(1500);
        j = await api(`/api/jobs/${job_id}`);
        if (j.total) { $('.progress i', body).style.width = `${Math.round(((j.progress - 0.5) / j.total) * 100)}%`; $('.step', body).textContent = `第 ${j.progress} / ${j.total} 段`; }
        if (j.status === 'done') break;
        if (j.status === 'error') throw new Error(j.error || '总结失败');
      }
      st.running = false;
      step3(j);
    } catch (e) {
      st.running = false;
      body.innerHTML = emptyHtml('log', esc(e.message));
      foot.disabled = false;
      foot.innerHTML = `${icon('refresh')}重新设置`;
      foot.onclick = () => { foot.innerHTML = `${icon('spark')}开始总结`; foot.onclick = startHandler; step1(); };
    }
  };
  const startHandler = foot.onclick;

  function step3(job) {
    const old = info.memory ? info.memory.content : '';
    body.innerHTML = `<p class="small muted" style="margin-top:0">读了 ${job.messages} 条消息。确认无误后再写入，写入前可以修改。</p>`;
    const view = h('<div></div>');
    const ta = h(`<textarea class="paper fill">${esc(job.result)}</textarea>`);
    const show = (v) => { view.innerHTML = ''; if (v === 'edit') view.append(ta); else view.innerHTML = `<div class="diff">${diffHtml(old, ta.value)}</div>`; };
    const sw = seg([['edit', '新内容'], ['diff', '和旧记忆对比']], 'edit', show, { small: true });
    sw.style.marginBottom = '10px';
    body.append(sw, view);
    show('edit');
    sheet.foot.innerHTML = '';
    const discard = h('<button class="btn ghost">不要了</button>');
    const write = h(`<button class="btn ink">${icon('check')}写入记忆</button>`);
    discard.onclick = () => sheet.close(true);
    write.onclick = () => run(write, async () => {
      await api('/api/memory/save', { scope, guild_id: gid, user_id: uid, content: ta.value, note: '区间总结', summarized_until: job.until });
      sheet.close(true);
      if (onDone) onDone();
    }, '已写入记忆');
    sheet.foot.append(discard, write);
  }

  step1();
}

async function openHistory(mem, onRestore) {
  const rows = await api(`/api/memory/versions?memory_id=${mem.id}`);
  const body = h('<div><div class="list"></div></div>');
  const sheet = openSheet({ title: '历史版本', body });
  const list = body.querySelector('.list');
  list.innerHTML = rows.map((v, i) => `<button class="item" data-i="${i}"><div class="grow"><div class="t">${fmtTime(v.created_at)} ${i === 0 ? '<span class="badge green">当前</span>' : ''}</div>
    <div class="s">${esc(v.note || '')} · ${v.content.length} 字</div></div><span class="chev">${icon('chev')}</span></button>`).join('') || emptyHtml('clock', '还没有历史版本');
  $$('[data-i]', list).forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.i;
      const v = rows[i];
      const prev = rows[i + 1];
      const b = h('<div></div>');
      const view = h('<div></div>');
      const show = (x) => { view.innerHTML = x === 'full' ? `<div class="prompt">${esc(v.content)}</div>` : `<div class="diff">${diffHtml(prev ? prev.content : '', v.content)}</div>`; };
      const sw = seg([['full', '完整内容'], ['diff', prev ? '和上一版对比' : '新增内容']], 'full', show, { small: true });
      sw.style.marginBottom = '10px';
      b.append(sw, view);
      show('full');
      const restore = h(`<button class="btn ink" ${i === 0 ? 'disabled' : ''}>${icon('refresh')}回到这个版本</button>`);
      const s2 = openSheet({ title: fmtTime(v.created_at), body: b, foot: [restore] });
      restore.onclick = () => run(restore, async () => {
        const r = await api('/api/memory/restore', { version_id: v.id });
        s2.close(true); sheet.close(true);
        onRestore(r.memory);
      }, '已回到这个版本，当前内容保留在历史里');
    };
  });
}

function diffHtml(a, b) {
  const x = (a || '').split('\n'); const y = (b || '').split('\n');
  const n = x.length; const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(`<span>${esc(x[i])}</span>`); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`<span class="del">${esc(x[i])}</span>`); i++; }
    else { out.push(`<span class="add">${esc(y[j])}</span>`); j++; }
  }
  while (i < n) out.push(`<span class="del">${esc(x[i++])}</span>`);
  while (j < m) out.push(`<span class="add">${esc(y[j++])}</span>`);
  return out.join('');
}

/* ---------- 群友 ---------- */
async function serverMembers(body, g) {
  body.innerHTML = '';
  const card = h(`<div class="sheet"><input type="search" placeholder="搜索昵称、用户名或 ID"><p class="hint total"></p><div class="list"></div></div>`);
  body.append(card);
  const list = card.querySelector('.list');
  const load = async () => {
    const q = card.querySelector('input').value.trim();
    const rows = await api(`/api/guilds/${g.id}/members?q=${encodeURIComponent(q)}`);
    card.querySelector('.total').textContent = q ? `找到 ${rows.length} 位` : `按发言数排序，共 ${rows.length} 位`;
    list.innerHTML = rows.slice(0, 200).map((m) => memberItem(m, true)).join('') || emptyHtml('user', q ? '没有找到' : '还没有同步到群友');
    $$('[data-uid]', list).forEach((el) => { el.onclick = () => openMember(g, rows.find((m) => m.user_id === el.dataset.uid), load); });
  };
  let t;
  card.querySelector('input').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  await load();
}

async function openMember(g, m, onChange) {
  const body = h(`<div>
    <div class="row" style="margin-bottom:14px">${avatarHtml(m.avatar, displayName(m), 'lg')}
      <div class="grow"><div style="font-size:19px;line-height:1.35">${esc(displayName(m))}</div>
      <div class="small muted">@${esc(m.username)}</div><div class="mono faint">${m.user_id}</div></div></div>
    <ul class="ledger">
      <li><span class="k">上下文里的身份</span><span class="dots"></span><span class="v small">${esc(m.tag)}</span></li>
      <li><span class="k">发言</span><span class="dots"></span><span class="v">${m.msgs} 条</span></li>
      <li><span class="k">曾用名</span><span class="dots"></span><span class="v small">${m.former.length ? esc(m.former.join('、')) : '无'}</span></li>
      <li><span class="k">状态</span><span class="dots"></span><span class="v small">${m.in_guild ? '在服务器里' : '已退出'}${m.is_bot ? ' · bot' : ''}</span></li>
    </ul><hr class="hr"><div class="mem"></div></div>`);
  openSheet({ title: esc(displayName(m)), body });
  const mem = body.querySelector('.mem');
  await memoryCard(mem, 'user', g.id, m.user_id, 'TA 的记忆');
  if (onChange) mem.addEventListener('click', () => setTimeout(onChange, 2000), { once: true });
}

/* ---------- 频道 ---------- */
/* ---------- 上下文起点 ---------- */
function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function startBadge(s) {
  return s ? `<span class="badge yellow">上下文从 ${fmtTime(s.start_ts)} 起</span>` : '';
}

/**
 * 上下文起点设置块（立即生效）。
 * channelId 固定时只管这个频道；否则可以选「所有频道」或某个频道（channels 为频道列表）。
 */
function contextStartBlock({ guildId, channelId = '', channels = [], onChange }) {
  const el = h('<div class="ctx-block"><div class="row" style="margin-bottom:6px"><span class="grow" style="font-size:16px">上下文起点</span><span class="badge">立即生效</span></div><div class="now"></div><div class="ctl"></div></div>');
  let starts = {};
  let target = channelId || 'all';
  let mode = 'now';
  let ts = Math.floor(Date.now() / 1000 - 3600);
  let msg = '';
  const chName = (id) => { const c = channels.find((x) => x.id === id); return c ? `#${c.name}` : '某个频道'; };

  const drawNow = () => {
    const box = $('.now', el);
    if (channelId) {
      const cur = starts[channelId];
      box.innerHTML = cur
        ? `<p class="small" style="margin:0 0 8px">bot 只看 <span class="mark">${fmtTime(cur.start_ts)}</span> 之后的消息，目前有 ${cur.after} 条。</p>
           ${cur.first ? `<div class="turn"><b>起点后的第一条 · ${esc(cur.first.who)}</b>${esc(cur.first.text) || '（无文字）'}</div>` : ''}`
        : '<p class="small muted" style="margin:0 0 8px">没有设置起点：每次回复带上最近若干条消息（上面的条数）。</p>';
      return;
    }
    const ids = Object.keys(starts);
    box.innerHTML = ids.length
      ? `<p class="small" style="margin:0 0 4px">已设置起点的频道：</p><ul class="ledger" style="margin-bottom:8px">${ids.map((id) => `<li><span class="k">${esc(chName(id))}</span><span class="dots"></span><span class="v small">${fmtTime(starts[id].start_ts)} 起 · ${starts[id].after} 条</span></li>`).join('')}</ul>`
      : '<p class="small muted" style="margin:0 0 8px">还没有频道设置起点：每次回复都带上最近若干条消息。改完人设想让 bot 忘掉之前聊的，可以在这里设置。</p>';
  };

  const drawCtl = () => {
    const box = $('.ctl', el);
    box.innerHTML = '';
    if (!channelId) {
      const sel = h(`<select><option value="all">所有频道</option>${channels.map((c) => `<option value="${c.id}" ${c.id === target ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`);
      sel.value = target;
      sel.onchange = () => { target = sel.value; drawCtl(); };
      box.append(field('作用于', sel));
    }
    box.append(field('从哪开始', seg([['now', '从现在'], ['time', '按时间'], ['message', '按消息']], mode, (v) => { mode = v; drawCtl(); })));
    if (mode === 'now') {
      box.append(h('<p class="hint" style="margin-top:-6px">之前的消息都不再带进上下文，相当于让 bot 忘掉刚才聊的。</p>'));
    } else if (mode === 'time') {
      const inp = h(`<input type="datetime-local" value="${toLocalInput(ts)}">`);
      inp.onchange = () => { ts = inp.value ? new Date(inp.value).getTime() / 1000 : null; };
      box.append(field('从这个时间开始', inp));
    } else {
      const inp = textInput(msg, (v) => { msg = v; }, { placeholder: target === 'all' ? '粘贴消息链接' : '消息链接或消息 ID' });
      box.append(field('从这条消息开始（包含它）', inp,
        target === 'all' ? '会自动识别链接属于哪个频道，只设置那个频道。手机上长按消息 → 复制消息链接。'
          : '手机上长按消息 → 复制消息链接。用链接更保险，复制错频道会提示。'));
    }
    const actions = h('<div class="actions"></div>');
    const hasCur = target === 'all' ? Object.keys(starts).length > 0 : !!starts[target];
    if (hasCur) {
      const reset = h(`<button class="btn ghost">${target === 'all' ? '全部恢复默认' : '恢复默认'}</button>`);
      reset.onclick = () => run(reset, async () => {
        const r = await api('/api/context/clear', target === 'all' ? { guild_id: guildId, all: true } : { guild_id: guildId, channel_ids: [target] });
        starts = r.starts; drawNow(); drawCtl(); if (onChange) onChange(starts);
      }, '已恢复默认');
      actions.append(reset);
    }
    const set = h(`<button class="btn ink">${icon('check')}设置起点</button>`);
    set.onclick = () => run(set, async () => {
      let body;
      if (target === 'all' && mode === 'message') {
        const m = msg.match(/channels\/(\d+|@me)\/(\d+)\/(\d+)/);
        if (!m) throw new Error('作用于所有频道时，请粘贴消息链接（链接里带着频道），或先选择具体频道');
        body = { guild_id: guildId, channel_ids: [m[2]], mode, message: msg };
      } else if (target === 'all') {
        if (mode === 'now' && !confirm('让所有频道都从现在开始，之前的消息不再带进上下文？')) return;
        body = { guild_id: guildId, all: true, mode, ts };
      } else {
        body = { guild_id: guildId, channel_ids: [target], mode, ts, message: msg };
      }
      const r = await api('/api/context/start', body);
      starts = r.starts; drawNow(); drawCtl(); if (onChange) onChange(starts);
      const scope = body.all ? '所有频道' : chName(body.channel_ids[0]);
      toast(`${scope}：bot 之后只看 ${fmtTime(r.start_ts)} 起的消息`);
    });
    actions.append(set);
    box.append(actions);
  };

  (async () => {
    try { starts = (await api(`/api/context/starts?guild_id=${guildId}`)).starts; } catch (_) { starts = {}; }
    if (channelId) { const only = starts[channelId]; starts = only ? { [channelId]: only } : {}; }
    drawNow();
    drawCtl();
  })();
  drawNow();
  drawCtl();
  return el;
}

function contextStartCard(guildId, channelId, current, onChange) {
  const card = h('<div class="sheet"></div>');
  card.append(contextStartBlock({ guildId, channelId, onChange }));
  return card;
}

async function importGuildCard(g, onDone) {
  const card = h(`<div class="sheet"><h3 class="tape blue">导入整个服务器的历史</h3>
    <p class="small muted" style="margin-top:0">bot 只会自动保存它进群之后的消息。这里会把每个频道更早的聊天记录拉下来，用来总结记忆。可以重复点，每次都接着往前拉，不会重复。</p>
    <div class="row wrap"><span class="small">每个频道最多</span><input type="number" min="1" value="2000" style="width:96px"><span class="small grow">条</span>
    <button class="btn ink">${icon('download')}开始导入</button></div>
    <div class="prog" hidden style="margin-top:12px"><div class="progress"><i></i></div><p class="hint txt"></p></div></div>`);
  const btn = card.querySelector('.btn');
  const prog = card.querySelector('.prog');
  const show = (j) => {
    if (!j) return;
    prog.hidden = false;
    const pct = j.total ? Math.round(((j.status === 'running' ? j.progress - 0.5 : j.progress) / j.total) * 100) : 0;
    prog.querySelector('i').style.width = `${Math.max(3, pct)}%`;
    const txt = prog.querySelector('.txt');
    if (j.status === 'running') {
      txt.innerHTML = `正在导入 #${esc(j.channel || '…')}（${j.progress}/${j.total}），已导入 <span class="mark">${fmtNum(j.imported)}</span> 条`;
      btn.disabled = true;
    } else if (j.status === 'done') {
      txt.innerHTML = `${esc(j.result)}${j.skipped && j.skipped.length ? `：${j.skipped.map((s) => '#' + esc(s)).join('、')}` : ''}`;
      btn.disabled = false;
    } else {
      txt.textContent = `导入失败：${j.error}`;
      btn.disabled = false;
    }
  };
  let timer;
  const poll = (jid) => {
    clearInterval(timer);
    timer = setInterval(async () => {
      try {
        const j = await api(`/api/jobs/${jid}`);
        show(j);
        if (j.status !== 'running') { clearInterval(timer); if (j.status === 'done') { toast(j.result); if (onDone) onDone(); } }
      } catch (e) { clearInterval(timer); }
    }, 1500);
    state.timers.push(timer);
  };
  btn.onclick = () => run(btn, async () => {
    const { job_id } = await api(`/api/guilds/${g.id}/import`, { limit: +card.querySelector('input').value || 2000 });
    show({ status: 'running', progress: 0, total: 0, imported: 0 });
    poll(job_id);
  });
  try {
    const cur = await api(`/api/guilds/${g.id}/import`);
    if (cur) { show(cur); if (cur.status === 'running') poll(cur.id); }
  } catch (_) { /* 忽略 */ }
  return card;
}

async function serverChannels(body, g) {
  const overrides = await api(`/api/config/channels?guild_id=${g.id}`);
  const { starts } = await api(`/api/context/starts?guild_id=${g.id}`);
  body.innerHTML = '';
  if (g.joined) body.append(await importGuildCard(g, () => loadGuilds()));
  const card = h(`<div class="sheet"><p class="hint" style="margin-top:0">点开频道可以单独设置人设、上下文起点和插话；右侧开关控制 bot 是否在这个频道工作。</p><div class="list"></div></div>`);
  body.append(card);
  const list = card.querySelector('.list');
  const text = g.channels.filter((c) => c.type !== 'category');
  if (!text.length) { list.innerHTML = emptyHtml('hash', '没有同步到频道'); return; }
  for (const c of text) {
    const data = overrides[c.id] || {};
    const custom = Object.keys(data).filter((k) => k !== 'enabled').length;
    const row = h(`<div class="item"><span class="avatar" style="width:32px;height:32px">${icon('hash')}</span>
      <div class="grow clickable" style="cursor:pointer"><div class="t">${esc(c.name)}</div>
      <div class="s">${custom ? `<span class="badge blue">单独设置了 ${custom} 项</span>` : '跟随服务器'} ${startBadge(starts[c.id])}</div></div></div>`);
    const sw = h(`<span class="switch"><input type="checkbox" ${data.enabled === false ? '' : 'checked'} aria-label="在 #${esc(c.name)} 启用"><span></span></span>`);
    sw.querySelector('input').onchange = (e) => run(null, async () => {
      const cur = (await api(`/api/config?scope_type=channel&scope_id=${c.id}`)).data || {};
      if (e.target.checked) delete cur.enabled; else cur.enabled = false;
      await api('/api/config', { scope_type: 'channel', scope_id: c.id, data: cur });
    }, e.target.checked ? `已在 #${c.name} 启用` : `已在 #${c.name} 停用`);
    row.append(sw);
    row.querySelector('.grow').onclick = () => openChannel(g, c, starts[c.id], () => { if (body.isConnected) serverChannels(body, g); });
    list.append(row);
  }
}

async function openChannel(g, c, start, onChange) {
  const body = h('<div></div>');
  const save = h('<button class="btn ink" disabled>保存</button>');
  let form;
  const sheet = openSheet({ title: `#${esc(c.name)}`, body, foot: [save], beforeClose: () => !form || !form.count() || confirmLeave(), onClose: onChange });
  const cfgBox = h('<div></div>');
  body.append(cfgBox);
  form = await configEditor(cfgBox, 'channel', c.id, {
    parentName: '服务器', guildId: g.id, channelId: c.id,
    onDirty: (n) => { save.disabled = !n; save.textContent = n ? `保存 ${n} 处改动` : '保存'; },
  });
  save.onclick = () => run(save, async () => { await form.save(); }, '已保存，立即生效');

  const imp = h(`<div class="sheet"><h3 class="tape blue">导入历史消息</h3>
    <p class="small muted" style="margin-top:0">从 Discord 拉取比已存记录更早的消息，用来总结记忆。</p>
    <div class="row"><input type="number" value="500" min="1" style="width:110px"><span class="small muted grow">条</span><button class="btn">${icon('download')}导入</button></div></div>`);
  body.append(imp);
  const btn = imp.querySelector('button');
  btn.onclick = () => run(btn, async () => {
    const { job_id } = await api(`/api/channels/${c.id}/import`, { limit: +imp.querySelector('input').value || 500 });
    for (;;) {
      await sleep(1500);
      const j = await api(`/api/jobs/${job_id}`);
      if (j.status === 'done') { toast(j.result); break; }
      if (j.status === 'error') throw new Error(j.error);
    }
  });
  return sheet;
}

/* ---------- 表情 ---------- */
async function serverEmoji(body, g) {
  const rows = await api(`/api/emojis?guild_id=${g.id}`);
  let filter = 'all';
  body.innerHTML = '';
  const cfgBox = h('<div></div>');
  body.append(cfgBox);
  await configEditor(cfgBox, 'guild', g.id, { parentName: '全局', guildId: g.id, sections: ['emoji'] });
  const top = h(`<div class="sheet"><div class="chips"></div><p class="hint" style="margin-bottom:0">新表情会自动生成描述，模型就是按描述挑表情的。手动改过的描述不会被覆盖。</p></div>`);
  const gridCard = h('<div class="sheet"><div class="emoji-grid"></div></div>');
  body.append(top, gridCard);
  const status = (e) => (e.description == null ? (e.fail >= 3 ? 'fail' : 'wait') : e.desc_manual ? 'manual' : 'ok');
  const counts = { all: rows.length, wait: 0, fail: 0, manual: 0 };
  rows.forEach((e) => { const s = status(e); if (counts[s] !== undefined) counts[s]++; });
  const filters = [['all', '全部'], ['wait', '等待打标'], ['fail', '打标失败'], ['manual', '手动填写']];
  const chips = top.querySelector('.chips');
  const drawChips = () => {
    chips.innerHTML = '';
    filters.forEach(([k, l]) => {
      if (k !== 'all' && !counts[k]) return;
      const c = h(`<button class="chip ${filter === k ? 'on' : ''}">${l} ${counts[k]}</button>`);
      c.onclick = () => { filter = k; drawChips(); drawGrid(); };
      chips.append(c);
    });
  };
  const grid = gridCard.querySelector('.emoji-grid');
  const drawGrid = () => {
    const shown = rows.filter((e) => filter === 'all' || status(e) === filter);
    grid.innerHTML = shown.map((e) => `<button class="emoji-tile" data-id="${e.id}" title="${esc(e.description || e.name)}">
      ${status(e) !== 'ok' ? `<span class="dot ${status(e)}"></span>` : ''}<img src="${esc(e.url)}" alt="" loading="lazy"><div class="n">${esc(e.name)}</div></button>`).join('');
    if (!shown.length) grid.outerHTML = emptyHtml('smile', '这里没有表情');
    $$('[data-id]', grid).forEach((el) => { el.onclick = () => openEmoji(rows.find((x) => x.id === el.dataset.id), () => serverEmoji(body, g)); });
  };
  drawChips();
  drawGrid();
  const all = h(`<div class="actions" style="justify-content:center"><button class="btn ghost danger">${icon('refresh')}全部重新打标</button></div>`);
  all.querySelector('button').onclick = (e) => {
    if (!confirm('给这个服务器的所有表情重新生成描述？手动填写的也会被覆盖。')) return;
    run(e.currentTarget, async () => { await api('/api/emojis/retag_all', { guild_id: g.id }); serverEmoji(body, g); }, '已加入打标队列');
  };
  body.append(all);
}

function openEmoji(e, onChange) {
  const st = e.description == null ? (e.fail >= 3 ? '打标失败，可以手动填写' : '等待自动打标') : e.desc_manual ? '手动填写' : '自动生成';
  const body = h(`<div>
    <div class="row" style="margin-bottom:14px"><img src="${esc(e.url)}" alt="" style="width:88px;height:88px;object-fit:contain;background:var(--field);border-radius:10px;padding:6px">
    <div class="grow"><div style="font-size:18px">${esc(e.name)}</div><div class="small muted">${e.kind === 'sticker' ? '贴纸' : '表情'} · 用过 ${e.uses} 次</div><div class="small muted">${st}</div></div></div>
    <span class="lab">描述（模型按这句话决定什么时候用它）</span><textarea style="min-height:90px">${esc(e.description || '')}</textarea></div>`);
  const ta = body.querySelector('textarea');
  const retag = h(`<button class="btn ghost">${icon('refresh')}重新打标</button>`);
  const save = h('<button class="btn ink">保存</button>');
  const sheet = openSheet({ title: e.kind === 'sticker' ? '贴纸' : '表情', body, foot: [retag, h('<span class="grow"></span>'), save] });
  save.onclick = () => run(save, async () => { await api(`/api/emojis/${e.id}`, { description: ta.value }); sheet.close(true); onChange(); }, '已保存');
  retag.onclick = () => run(retag, async () => { await api(`/api/emojis/${e.id}/retag`, {}); sheet.close(true); onChange(); }, '已加入打标队列，稍后刷新查看');
}

/* ================= 日志 ================= */
async function pageLogs(main) {
  main.innerHTML = pageHead('日志', '实时运行记录和报错');
  let level = 'all';
  let paused = false;
  let q = '';
  const items = [];
  const top = h('<div class="sheet"><div class="row wrap"><div class="chips"></div><button class="btn sm right pause"></button></div><input type="search" placeholder="搜索日志" style="margin-top:10px"></div>');
  const box = h('<div class="logbox" aria-live="polite"></div>');
  const errCard = h('<div class="sheet" style="margin-top:16px"><div class="sheet-head"><h3 class="tape red">报错记录</h3><button class="btn ghost sm danger">清空</button></div><div class="list"></div></div>');
  main.append(top, box, errCard);
  const levels = [['all', '全部'], ['warn', '警告和报错'], ['error', '只看报错']];
  const chips = top.querySelector('.chips');
  const pass = (r) => (level === 'all' || (level === 'warn' && r.level !== 'INFO' && r.level !== 'DEBUG') || (level === 'error' && (r.level === 'ERROR' || r.level === 'CRITICAL')))
    && (!q || `${r.logger} ${r.message}`.toLowerCase().includes(q));
  const line = (r) => { const d = document.createElement('div'); d.className = r.level; d.textContent = `${new Date(r.ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })} ${r.logger}: ${r.message}`; return d; };
  const redraw = () => { box.innerHTML = ''; items.filter(pass).forEach((r) => box.append(line(r))); box.scrollTop = box.scrollHeight; };
  const drawChips = () => {
    chips.innerHTML = '';
    levels.forEach(([k, l]) => { const c = h(`<button class="chip ${level === k ? 'on' : ''}">${l}</button>`); c.onclick = () => { level = k; drawChips(); redraw(); }; chips.append(c); });
  };
  drawChips();
  const pauseBtn = top.querySelector('.pause');
  const drawPause = () => { pauseBtn.innerHTML = paused ? `${icon('play')}继续滚动` : `${icon('pause')}暂停滚动`; };
  drawPause();
  pauseBtn.onclick = () => { paused = !paused; drawPause(); if (!paused) box.scrollTop = box.scrollHeight; };
  let t;
  top.querySelector('input').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); redraw(); }, 200); };
  let after = 0;
  every(2000, async () => {
    try {
      const rows = await api(`/api/logs?after=${after}`);
      if (!rows.length) return;
      after = rows[rows.length - 1].seq;
      items.push(...rows);
      if (items.length > 1500) items.splice(0, items.length - 1500);
      rows.filter(pass).forEach((r) => box.append(line(r)));
      while (box.childElementCount > 1500) box.firstElementChild.remove();
      if (!paused) box.scrollTop = box.scrollHeight;
    } catch (_) { /* 忽略 */ }
  });
  const loadErr = async () => {
    const rows = await api('/api/errors');
    errCard.querySelector('.list').innerHTML = rows.map((r) => `<div class="item" style="display:block"><div class="s">${fmtTime(r.ts)} · ${esc(r.logger)}</div><div class="t small">${esc(r.message)}</div>
      ${r.trace ? `<details><summary>查看堆栈</summary><pre class="trace">${esc(r.trace)}</pre></details>` : ''}</div>`).join('') || emptyHtml('check', '没有报错');
  };
  errCard.querySelector('.danger').onclick = (e) => run(e.currentTarget, async () => { await api('/api/errors/clear', {}); await loadErr(); }, '已清空');
  await loadErr();
}

/* ================= 设置 ================= */
const SETTINGS = [
  ['bot', 'key', '机器人连接', 'token、在线状态和邀请链接'],
  ['api', 'chat', '接口与模型', '反代地址、Key，以及各用途用哪个模型'],
  ['search', 'search', '联网搜索', '配置聊天工具使用的搜索服务'],
  ['persona', 'pen', '默认人设', '所有服务器默认的人设、上下文和插话方式'],
  ['dm', 'mail', '私聊', '谁能私聊 bot，私聊时用哪套人设和记忆'],
  ['usage', 'coin', '用量账本', '每天用了多少 tokens、花了多少钱'],
  ['general', 'sliders', '通用', '时区、防抖、表情数量等'],
  ['password', 'lock', '后台密码', '修改登录密码'],
];

async function pageSettings(main) {
  main.innerHTML = pageHead('设置');
  main.append(h(`<div class="sheet"><div class="list">${SETTINGS.map(([k, ic, t, s]) => `<a class="item" href="#/settings/${k}">
    <span class="avatar" style="width:36px;height:36px">${icon(ic)}</span><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div><span class="chev">${icon('chev')}</span></a>`).join('')}</div></div>`));
  const out = h(`<div class="actions" style="justify-content:center"><button class="btn ghost">${icon('logout')}退出登录</button></div>`);
  out.querySelector('button').onclick = async () => { await api('/api/logout', {}); showLogin(); };
  main.append(out);
}

async function pageSettingsSub(main, key) {
  const entry = SETTINGS.find((s) => s[0] === key);
  if (!entry) { go('#/settings'); return; }
  main.innerHTML = pageHead(entry[2], '', '#/settings', '设置');
  const body = h('<div></div>');
  main.append(body);
  body.innerHTML = skeleton(3);
  await ({ bot: setBot, api: setApi, search: setSearch, persona: setPersona, dm: setDm, usage: setUsage, general: setGeneral, password: setPassword })[key](body);
}

/* ---------- 机器人连接 ---------- */
async function setBot(body) {
  body.innerHTML = '';
  const card = h('<div class="sheet"></div>');
  const tok = h(`<div class="sheet"><h3 class="tape yellow">Bot token</h3>
    <p class="small muted" style="margin-top:0">当前：<span class="mono mask">-</span></p>
    <input type="password" placeholder="粘贴新的 token" autocomplete="off">
    <p class="hint">在 Discord Developer Portal → Bot 页面点 Reset Token 获取。同一页面要打开 Server Members Intent 和 Message Content Intent。</p>
    <div class="actions"><button class="btn ink">${icon('check')}保存并连接</button></div></div>`);
  const inv = h(`<div class="sheet" hidden><h3 class="tape green">邀请进服务器</h3>
    <p class="small muted" style="margin-top:0">用有管理权限的账号打开链接，选择要加入的服务器。权限已经按需要配好。</p>
    <div class="actions" style="justify-content:flex-start"><a class="btn ink" target="_blank" rel="noopener">${icon('link')}打开邀请链接</a><button class="btn">复制链接</button></div></div>`);
  body.append(card, tok, inv);
  let invite = '';
  const refresh = async () => {
    const s = await api('/api/status');
    card.innerHTML = `<div class="polaroid">
      <div class="photo">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : `<div class="ph">${icon('user')}</div>`}</div>
      <div class="who grow"><h2>${esc(s.user ? s.user.replace(/#0$/, '') : '未连接')}</h2>
        <div class="small muted">${s.state === 'online' ? `${s.guilds} 个服务器 · 延迟 ${s.latency_ms ?? '-'} ms · 已连接 ${duration(s.connected_at)}` : (s.error ? esc(s.error) : '填好 token 后会自动连接')}</div></div>
      <div class="stamp ${s.state}">${STATE_TEXT[s.state] || s.state}</div></div>
      <div class="actions"><button class="btn ghost danger" data-a="stop">断开</button><button class="btn" data-a="start">${icon('refresh')}重新连接</button></div>`;
    card.querySelector('[data-a=start]').onclick = (e) => run(e.currentTarget, async () => { await api('/api/bot/start', {}); await sleep(1200); await refresh(); }, '正在连接');
    card.querySelector('[data-a=stop]').onclick = (e) => run(e.currentTarget, async () => { await api('/api/bot/stop', {}); await refresh(); }, '已断开');
    tok.querySelector('.mask').textContent = s.token_masked || '未设置';
    invite = s.invite_url || '';
    inv.hidden = !invite;
    if (invite) inv.querySelector('a').href = invite;
  };
  await refresh();
  state.timers.push(setInterval(() => refresh().catch(() => {}), 5000));
  tok.querySelector('.btn.ink').onclick = (e) => run(e.currentTarget, async () => {
    const input = tok.querySelector('input');
    if (!input.value.trim()) throw new Error('先粘贴 token');
    await api('/api/bot/token', { token: input.value.trim() });
    input.value = '';
    await sleep(1500); await refresh(); loadGuilds();
  }, 'token 已保存，正在连接');
  inv.querySelector('button').onclick = async () => { try { await navigator.clipboard.writeText(invite); toast('已复制'); } catch (_) { prompt('复制这个链接', invite); } };
}

/* ---------- 接口与模型 ---------- */
const PURPOSE_HELP = {
  chat: '群聊和私聊的回复',
  judge: '主动插话前先判断要不要说话，用便宜的小模型就行',
  summary: '把聊天记录总结成记忆',
  tagging: '给表情生成描述，必须支持看图',
  fallback: '上面的模型报错时临时顶上，可以不设',
};

async function setApi(body) {
  const res = await api('/api/providers');
  res.providers.forEach((p) => { state.modelLists[p.id] = p.model_list || []; });
  const initial = { providers: res.providers.map((p) => ({ ...p, api_key: '' })), models: res.models };
  const expanded = new Set(initial.providers.length ? [] : ['new0']);
  let form;
  const draw = () => {
    body.innerHTML = '';
    const d = form.draft;
    const pCard = h(`<div class="sheet"><h3 class="tape blue">供应商</h3><div class="plist"></div>
      <div class="actions" style="justify-content:flex-start"><button class="btn">${icon('plus')}添加供应商</button></div>
      <p class="hint">OpenAI 兼容格式填到 /v1 为止，例如 https://你的反代/v1；Claude 格式填域名即可，会自动补上 /v1/messages。</p></div>`);
    const plist = pCard.querySelector('.plist');
    d.providers.forEach((p, i) => {
      const key = p.id || `new${i}`;
      const open = expanded.has(key);
      const el = h(`<div style="border-top:1px dashed var(--rule);padding:10px 0">
        <button class="item" style="padding:0;border:0"><div class="grow"><div class="t">${esc(p.name || '未命名')}</div>
        <div class="s">${p.format === 'claude' ? 'Claude 格式' : 'OpenAI 兼容'} · ${esc(p.base_url || '还没填地址')}</div></div>
        ${p.id ? '' : '<span class="badge yellow">未保存</span>'}<span class="chev" style="transform:rotate(${open ? 90 : 0}deg)">${icon('chev')}</span></button>
        <div class="pbody" ${open ? '' : 'hidden'} style="padding-top:12px"></div></div>`);
      if (i === 0) el.style.borderTop = '0';
      el.querySelector('.item').onclick = () => { if (open) expanded.delete(key); else expanded.add(key); draw(); };
      const pb = el.querySelector('.pbody');
      if (open) {
        const upd = (k, v) => { d.providers[i] = { ...d.providers[i], [k]: v }; form.changed(); };
        pb.append(field('名称', textInput(p.name, (v) => upd('name', v))));
        pb.append(field('格式', seg([['openai', 'OpenAI 兼容'], ['claude', 'Claude']], p.format === 'claude' ? 'claude' : 'openai', (v) => upd('format', v))));
        pb.append(field('API 地址', textInput(p.base_url, (v) => upd('base_url', v), { placeholder: 'https://' })));
        pb.append(field(`API Key${p.api_key_masked ? `（当前 ${p.api_key_masked}，留空不改）` : ''}`, textInput(p.api_key, (v) => upd('api_key', v), { type: 'password' })));
        const tools = h(`<div class="row wrap"><button class="btn sm" data-a="models">${icon('download')}获取模型列表</button>
          <input type="text" placeholder="测试用的模型名" class="grow" style="flex-basis:140px" list="ml-${esc(p.id || 'x')}">
          <button class="btn sm" data-a="test">测试</button><button class="btn sm ghost danger" data-a="del">${icon('trash')}</button></div>`);
        const out = h('<p class="hint"></p>');
        const payload = () => ({ id: p.id, format: d.providers[i].format, base_url: d.providers[i].base_url, api_key: d.providers[i].api_key });
        tools.querySelector('[data-a=models]').onclick = (e) => run(e.currentTarget, async () => {
          const r = await api('/api/providers/models', { provider: payload() });
          if (!r.ok) throw new Error(r.error);
          if (p.id) state.modelLists[p.id] = r.models;
          out.textContent = `拿到 ${r.models.length} 个模型，填模型名时会出现候选`;
          draw();
        });
        tools.querySelector('[data-a=test]').onclick = (e) => run(e.currentTarget, async () => {
          const model = tools.querySelector('input').value.trim();
          if (!model) throw new Error('先填一个模型名');
          const r = await api('/api/providers/test', { provider: payload(), model });
          out.textContent = (r.ok ? '连接正常：' : '失败：') + r.result;
        });
        tools.querySelector('[data-a=del]').onclick = () => { if (confirm(`删除「${p.name}」？保存后生效。`)) { d.providers.splice(i, 1); form.changed(); draw(); } };
        pb.append(tools, out);
        if (p.id && state.modelLists[p.id]) pb.append(h(`<datalist id="ml-${esc(p.id)}">${state.modelLists[p.id].map((m) => `<option value="${esc(m)}">`).join('')}</datalist>`));
      }
      plist.append(el);
    });
    if (!d.providers.length) plist.innerHTML = emptyHtml('chat', '还没有供应商');
    pCard.querySelector('.actions .btn').onclick = () => { d.providers.push({ name: '我的反代', format: 'claude', base_url: '', api_key: '' }); expanded.add(`new${d.providers.length - 1}`); form.changed(); draw(); };
    body.append(pCard);

    const mCard = h(`<div class="sheet"><h3 class="tape green">各用途用哪个模型</h3><div class="mlist"></div></div>`);
    const mlist = mCard.querySelector('.mlist');
    const saved = d.providers.filter((p) => p.id);
    Object.entries(res.purposes).forEach(([k, label], idx) => {
      const m = d.models[k] || {};
      const upd = (f, v) => { d.models = { ...d.models, [k]: { ...d.models[k], [f]: v } }; form.changed(); };
      const el = h(`<div style="${idx ? 'border-top:1px dashed var(--rule);' : ''}padding:12px 0">
        <div class="row"><div class="grow"><div>${esc(label.replace(/（.*）/, ''))}</div><div class="small faint">${PURPOSE_HELP[k] || ''}</div></div>
        ${m.provider && m.model ? '<span class="badge green">已设置</span>' : '<span class="badge">未设置</span>'}</div><div class="row wrap" style="margin-top:8px"></div></div>`);
      const row = el.querySelector('.row.wrap');
      const sel = h(`<select style="flex:1 1 130px"><option value="">选择供应商</option>${saved.map((p) => `<option value="${p.id}" ${p.id === m.provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`);
      sel.onchange = () => { upd('provider', sel.value); draw(); };
      const inp = modelInput(m.model, (v) => upd('model', v), { providerId: m.provider || '' });
      inp.style.flex = '1 1 160px';
      row.append(sel, inp);
      const adv = h(`<details style="margin-top:6px"><summary>输出长度和温度</summary><div class="row" style="padding-top:6px"></div></details>`);
      const a = field('最大输出 tokens', numberInput(m.max_tokens ?? 1024, (v) => upd('max_tokens', v), { min: 16 }), '开了思考的模型要给大一些，比如 2000 以上');
      const b = field('温度', numberInput(m.temperature ?? 0.9, (v) => upd('temperature', v), { step: '0.05', min: 0 }));
      a.classList.add('grow'); b.classList.add('grow');
      adv.querySelector('.row').append(a, b);
      el.append(adv);
      mlist.append(el);
    });
    if (d.providers.some((p) => !p.id)) mCard.append(h('<p class="hint">新添加的供应商保存后才能在这里选择。</p>'));
    body.append(mCard);
  };
  form = makeForm(initial, {
    onSave: async (draft) => {
      const r = await api('/api/providers', { providers: draft.providers.map(({ id, name, format, base_url, api_key }) => ({ id, name, format, base_url, api_key })) });
      await api('/api/models', { models: draft.models });
      draft.providers = r.providers.map((p) => ({ ...p, api_key: '' }));
      state.providers = r.providers;
      r.providers.forEach((p) => { state.modelLists[p.id] = p.model_list || []; });
      expanded.clear();
      setTimeout(draw, 0);
    },
    onDirty: barDirty,
    onReset: () => draw(),
  });
  draw();
}

/* ---------- 默认人设 ---------- */
async function setSearch(body) {
  const saved = await api('/api/search');
  const form = makeForm({ ...saved, api_key: '', clear_key: false }, {
    onSave: async (draft) => {
      const r = await api('/api/search', draft);
      Object.assign(draft, r.data, { api_key: '', clear_key: false });
      setTimeout(draw, 0);
    }, onDirty: barDirty, onReset: () => draw(),
  });
  const draw = () => {
    body.innerHTML = '';
    const card = h('<div class="sheet"><h3 class="tape blue">搜索服务</h3></div>');
    const select = h('<select><option value="tavily">Tavily</option><option value="searxng">SearXNG</option></select>');
    select.value = form.draft.backend;
    select.onchange = () => {
      form.set('backend', select.value);
      form.set('base_url', select.value === 'tavily' ? 'https://api.tavily.com' : '');
      draw();
    };
    card.append(field('服务', select));
    card.append(field('服务地址', textInput(form.draft.base_url, (v) => form.set('base_url', v), { placeholder: 'https://' }), '填写服务根地址或 /search 地址；SearXNG 必须开启 JSON 格式'));
    card.append(field(`API Key${form.draft.api_key_masked ? `（当前 ${form.draft.api_key_masked}）` : ''}`, textInput(form.draft.api_key, (v) => form.set('api_key', v), { type: 'password' }), 'Tavily 需要 Key；留空保留原值。SearXNG 不发送此 Key。'));
    card.append(switchRow('清除已保存的 Key', '', form.draft.clear_key, (v) => form.set('clear_key', v)));
    card.append(field('每次搜索最多结果数', numberInput(form.draft.max_results, (v) => form.set('max_results', v), { min: 1 }), '1–10 条'));
    const test = h('<div><div class="field"><span class="lab">测试搜索词</span><input type="text" aria-label="测试搜索词" value="今天的新闻"></div><div class="actions"><button type="button" class="btn">测试已保存的配置</button></div><pre class="search-test" hidden></pre></div>');
    test.querySelector('button').onclick = (e) => run(e.currentTarget, async () => {
      const r = await api('/api/search/test', { query: test.querySelector('input').value });
      const out = test.querySelector('pre');
      out.hidden = false;
      out.textContent = JSON.stringify(r.result, null, 2);
      if (!r.ok) throw new Error(r.result.error || '搜索失败');
    });
    card.append(test);
    body.append(card, h('<p class="hint">在「默认人设」或服务器、频道的「聊天模型与联网」里开启搜索服务模式。Claude 原生搜索直接使用模型供应商，无需此处的服务或 Key。纯聊天不调用搜索。</p>'));
  };
  draw();
}

async function setPersona(body) {
  body.innerHTML = '<p class="small muted" style="margin:0 0 14px 2px">这里是所有服务器的默认值。某个服务器想要不一样，到「服务器 › 人设」里单独设置。</p>';
  const box = h('<div></div>');
  body.append(box);
  await configEditor(box, 'global', 'global', {});
}

/* ---------- 私聊 ---------- */
async function setDm(body) {
  await loadGuilds();
  const d = await api('/api/dm');
  const form = makeForm(d, { onSave: (x) => api('/api/dm', x), onDirty: barDirty, onReset: () => draw() });
  const modes = { guild: '加载某个服务器的人设和记忆，像在那个群里一样聊', persona: '只用人设，不加载任何记忆', own: '私聊有自己独立的一份记忆（在「服务器」之外单独保存）' };
  const draw = () => {
    const x = form.draft;
    body.innerHTML = '';
    const who = h(`<div class="sheet"><h3 class="tape pink">谁能私聊</h3>
      <p class="small muted" style="margin-top:0">只有这里列出的 Discord 用户 ID 能私聊 bot，其他人的私聊会被忽略。</p>
      <div class="chips ids" style="margin-bottom:10px"></div>
      <div class="row"><input type="text" inputmode="numeric" placeholder="粘贴用户 ID" class="grow"><button class="btn">${icon('plus')}添加</button></div>
      <p class="hint">获取 ID：Discord 设置 → 高级 → 打开开发者模式，然后长按头像 → 复制用户 ID。</p></div>`);
    const ids = who.querySelector('.ids');
    x.whitelist.forEach((id, i) => {
      const c = h(`<span class="chip on" style="display:inline-flex;gap:4px;align-items:center">${esc(id)}<button class="icon-btn" style="width:20px;height:20px;color:inherit" aria-label="移除">${icon('close')}</button></span>`);
      c.querySelector('button').onclick = () => { x.whitelist.splice(i, 1); form.changed(); draw(); };
      ids.append(c);
    });
    if (!x.whitelist.length) ids.innerHTML = '<span class="small faint">还没有人</span>';
    const add = () => {
      const v = who.querySelector('input').value.trim();
      if (!/^\d{5,}$/.test(v)) { toast('用户 ID 是一串数字', true); return; }
      if (!x.whitelist.includes(v)) x.whitelist.push(v);
      form.changed(); draw();
    };
    who.querySelector('.btn').onclick = add;
    who.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    const how = h(`<div class="sheet"><h3 class="tape blue">私聊时怎么表现</h3></div>`);
    how.append(field('模式', seg([['guild', '像在群里'], ['persona', '只用人设'], ['own', '独立记忆']], x.mode, (v) => { form.set('mode', v); draw(); }), modes[x.mode]));
    const sel = h(`<select><option value="">全局默认人设</option>${state.guilds.map((g) => `<option value="${g.id}" ${g.id === x.guild_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`);
    sel.onchange = () => form.set('guild_id', sel.value);
    how.append(field(x.mode === 'guild' ? '像在哪个服务器里' : '人设取自', sel));
    how.append(h(`<p class="hint">也可以在私聊里发 <span class="mono">!mode</span> 查看和切换。私聊内容不会写进任何服务器的记忆。</p>`));
    body.append(who, how, convCard);
  };
  const convCard = h(`<div class="sheet"><h3 class="tape yellow">私聊上下文</h3>
    <p class="small muted" style="margin-top:0">点开对话可以设置上下文从哪开始。在私聊里发 <span class="mono">!forget</span> 也能直接从当前开始。</p><div class="list"></div></div>`);
  const loadConvs = async () => {
    const { starts, conversations } = await api('/api/context/starts?guild_id=dm');
    const list = convCard.querySelector('.list');
    list.innerHTML = conversations.map((c) => `<button class="item" data-cid="${c.channel_id}"><span class="avatar">${icon('mail')}</span>
      <div class="grow"><div class="t">${esc(c.tag)}</div><div class="s">${c.n} 条消息 · 最后 ${ago(c.last)} ${startBadge(starts[c.channel_id])}</div></div>
      <span class="chev">${icon('chev')}</span></button>`).join('') || emptyHtml('mail', '还没有私聊记录');
    $$('[data-cid]', list).forEach((el) => {
      el.onclick = () => {
        const c = conversations.find((x) => x.channel_id === el.dataset.cid);
        openSheet({ title: esc(c.tag), body: contextStartCard('dm', c.channel_id, starts[c.channel_id] || null), onClose: () => { if (convCard.isConnected) loadConvs(); } });
      };
    });
  };
  draw();
  loadConvs();
}

/* ---------- 用量账本 ---------- */
async function setUsage(body) {
  let days = 7;
  let by = 'by_purpose';
  body.innerHTML = '';
  const top = h('<div style="margin-bottom:14px"></div>');
  const sum = h('<div class="sheet"></div>');
  const brk = h('<div class="sheet"><div class="sheet-head"><h3 class="tape yellow">花在哪了</h3></div><div class="bk"></div></div>');
  const priceBox = h('<div></div>');
  body.append(top, sum, brk, priceBox);
  top.append(seg([['1', '今天'], ['7', '7 天'], ['30', '30 天'], ['90', '90 天']], '7', (v) => { days = +v; load(); }));
  const bySeg = seg([['by_purpose', '按用途'], ['by_guild', '按服务器'], ['by_model', '按模型']], by, (v) => { by = v; drawBreak(); }, { small: true });
  brk.querySelector('.sheet-head').append(bySeg);
  let u;
  let prices;
  const drawBreak = () => {
    const rows = u[by];
    const max = Math.max(1, ...rows.map((r) => r.input + r.output + r.cache_read));
    brk.querySelector('.bk').innerHTML = rows.length ? `<ul class="ledger">${rows.map((r) => `<li style="display:block">
      <div class="row" style="align-items:baseline;gap:6px"><span class="k" style="max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.key)}</span><span class="dots" style="flex:1;border-bottom:2px dotted var(--rule);transform:translateY(-4px)"></span>
      <span class="v num">${fmtNum(r.input + r.output + r.cache_read)}<small>tokens</small>${Object.keys(prices).length ? ` · ${fmtMoney(r.cost)}` : ''}</span></div>
      <div class="meter"><i style="width:${((r.input + r.output + r.cache_read) / max) * 100}%"></i></div>
      <div class="small faint">${r.calls} 次调用${r.fails ? ` · <span class="mark">${r.fails} 次失败</span>` : ''}</div></li>`).join('')}</ul>` : emptyHtml('coin', '这段时间还没有调用');
  };
  const load = async () => {
    u = await api(`/api/usage?days=${days}`);
    const pr = await api('/api/prices');
    prices = pr.prices;
    const t = u.total;
    const has = Object.keys(prices).length > 0;
    const max = Math.max(1, ...u.daily.map((x) => x.input + x.output + x.cache_read));
    sum.innerHTML = `<h3 class="tape blue">合计</h3><ul class="ledger">
      <li><span class="k">花费</span><span class="dots"></span><span class="v"><span class="mark" style="font-size:19px">${has ? fmtMoney(t.cost) : '未设单价'}</span></span></li>
      <li><span class="k">调用</span><span class="dots"></span><span class="v">${fmtNum(t.calls)} 次${t.fails ? `<small>失败 ${t.fails}</small>` : ''}</span></li>
      <li><span class="k">输入</span><span class="dots"></span><span class="v">${fmtNum(t.input)}<small>tokens</small></span></li>
      <li><span class="k">输出</span><span class="dots"></span><span class="v">${fmtNum(t.output)}<small>tokens</small></span></li>
      <li><span class="k">缓存命中</span><span class="dots"></span><span class="v">${fmtNum(t.cache_read)}<small>tokens</small></span></li>
      ${t.cache_write ? `<li><span class="k">缓存写入</span><span class="dots"></span><span class="v">${fmtNum(t.cache_write)}<small>tokens</small></span></li>` : ''}</ul>
      ${u.daily.length > 1 ? `<div class="bars">${u.daily.map((x) => `<span style="height:${Math.max(3, ((x.input + x.output + x.cache_read) / max) * 100)}%" title="${x.key}"></span>`).join('')}</div>
      <div class="bar-labels">${u.daily.map((x, i) => `<span>${u.daily.length <= 10 || i % Math.ceil(u.daily.length / 8) === 0 ? x.key.slice(3) : ''}</span>`).join('')}</div>` : ''}`;
    drawBreak();
    drawPrices(pr);
  };
  const drawPrices = (pr) => {
    const models = [...new Set([...pr.models, ...Object.keys(pr.prices)])];
    priceBox.innerHTML = '';
    const card = h(`<div class="sheet"><h3 class="tape green">单价</h3><p class="small muted" style="margin-top:0">每 100 万 tokens 的价格，单位自己定（美元、人民币都行）。按反代的实际价格填，算出来才是真实花费。</p><div class="pl"></div></div>`);
    const form = makeForm(pr.prices, { onSave: async (x) => { await api('/api/prices', { prices: x }); load(); }, onDirty: barDirty, onReset: () => drawPrices(pr) });
    const pl = card.querySelector('.pl');
    const cols = [['input', '输入'], ['output', '输出'], ['cache_read', '缓存读'], ['cache_write', '缓存写']];
    models.forEach((m) => {
      const p = form.draft[m] || {};
      const el = h(`<details style="border-top:1px dashed var(--rule);padding:6px 0"><summary><span class="mono">${esc(m)}</span> <span class="small faint">${p.input ? `${p.input} / ${p.output}` : '未填'}</span></summary><div class="row wrap" style="padding:8px 0"></div></details>`);
      const row = el.querySelector('.row');
      cols.forEach(([k, l]) => {
        const f = field(l, numberInput(p[k] ?? '', (v) => { form.draft[m] = { ...(form.draft[m] || {}), [k]: v || 0 }; form.changed(); }, { step: '0.001', min: 0 }));
        f.style.flex = '1 1 70px';
        row.append(f);
      });
      pl.append(el);
    });
    if (!models.length) pl.innerHTML = '<p class="small faint">有调用记录后，这里会列出用过的模型。</p>';
    priceBox.append(card);
  };
  await load();
}

/* ---------- 通用 ---------- */
const GENERAL_FIELDS = [
  ['timezone', '时区', 'text', '聊天记录里的时间戳按这个时区显示，例如 Asia/Shanghai'],
  ['debounce_seconds', '防抖等待（秒）', 'number', '收到消息后等这么久没有新消息再处理，避免连发好几条回复'],
  ['gap_minutes', '标注时间间隔（分钟）', 'number', '两条消息相隔超过这么久时，在上下文里写明隔了多久'],
  ['max_reactions', '每次最多点几个反应', 'number', ''],
  ['judge_context_lines', '插话判断看多少条消息', 'number', '判断要不要插话时，给小模型看最近几条'],
  ['respond_to_bots', '回应其他 bot', 'bool', '打开后其他 bot 的消息也可能触发回复，小心两个 bot 互相聊个没完'],
];

async function setGeneral(body) {
  const g = await api('/api/general');
  const form = makeForm(g.data, { onSave: (x) => api('/api/general', { data: x }), onDirty: barDirty, onReset: () => draw() });
  const draw = () => {
    body.innerHTML = '';
    const card = h('<div class="sheet"></div>');
    GENERAL_FIELDS.forEach(([k, label, type, help]) => {
      if (type === 'bool') card.append(switchRow(label, help, form.draft[k], (v) => form.set(k, v)));
      else if (type === 'number') card.append(field(label, numberInput(form.draft[k], (v) => form.set(k, v), { step: 'any', min: 0 }), help));
      else card.append(field(label, textInput(form.draft[k], (v) => form.set(k, v)), help));
    });
    body.append(card);
  };
  draw();
}

/* ---------- 密码 ---------- */
async function setPassword(body) {
  body.innerHTML = `<div class="sheet">
    <div class="field"><span class="lab">现在的密码</span><input type="password" id="pwOld" autocomplete="current-password"></div>
    <div class="field"><span class="lab">新密码（至少 8 位）</span><input type="password" id="pwNew" autocomplete="new-password"></div>
    <div class="field"><span class="lab">再输一次新密码</span><input type="password" id="pwNew2" autocomplete="new-password"></div>
    <div class="actions"><button class="btn ink" id="pwSave">修改密码</button></div></div>`;
  $('#pwSave').onclick = (e) => run(e.currentTarget, async () => {
    if ($('#pwNew').value !== $('#pwNew2').value) throw new Error('两次输入的新密码不一样');
    await api('/api/password', { old: $('#pwOld').value, new: $('#pwNew').value });
    toast('密码已修改，请重新登录');
    showLogin();
  });
}

/* ================= 启动 ================= */
(async () => {
  try {
    const s = await api('/api/session');
    if (s.ok) start(); else showLogin();
  } catch (_) { showLogin(); }
})();
