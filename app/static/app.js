'use strict';

// ============ 工具 ============
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtTs = (ts) => ts ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';
const fmtNum = (n) => (n || 0).toLocaleString('en-US');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, bad ? 4500 : 2200);
}

async function api(path, body, method) {
  const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (res.status === 401 && !path.startsWith('/api/login')) { showLogin(); throw new Error('请先登录'); }
  let data = null;
  try { data = await res.json(); } catch (_) { /* 空响应 */ }
  if (!res.ok) throw new Error((data && data.detail) || `请求失败（${res.status}）`);
  return data;
}

async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

function modal(inner) {
  const bg = h(`<div class="modal-bg"><div class="modal"></div></div>`);
  bg.querySelector('.modal').append(inner);
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.append(bg);
  return bg;
}

const state = { tab: 'status', timers: [], guilds: [], providers: [] };
function every(ms, fn) { fn(); state.timers.push(setInterval(fn, ms)); }
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

async function loadGuilds() {
  try { state.guilds = await api('/api/guilds'); } catch (_) { state.guilds = []; }
  return state.guilds;
}
const guildName = (id) => (id === 'dm' ? '私聊' : (state.guilds.find((g) => g.id === id) || {}).name || id);
function guildOptions(selected, { dm = false, all = false, allLabel = '全部服务器' } = {}) {
  let html = all ? `<option value="">${allLabel}</option>` : '';
  html += state.guilds.map((g) => `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${esc(g.name)}${g.joined ? '' : '（已离开）'}</option>`).join('');
  if (dm) html += `<option value="dm" ${selected === 'dm' ? 'selected' : ''}>私聊</option>`;
  return html;
}

// ============ 登录 ============
function showLogin() {
  clearTimers();
  $('#top').hidden = true;
  const main = $('#main');
  main.innerHTML = '';
  const box = h(`<div class="login card">
    <h1>LazyBot 后台</h1>
    <div class="field"><label>密码</label><input type="password" id="pw" autocomplete="current-password"></div>
    <button class="btn primary" id="loginBtn" style="width:100%">登录</button>
  </div>`);
  main.append(box);
  const go = () => run($('#loginBtn'), async () => {
    await api('/api/login', { password: $('#pw').value });
    start();
  });
  $('#loginBtn').onclick = go;
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#pw').focus();
}

// ============ 框架 ============
const TABS = [
  ['status', '状态'], ['guilds', '服务器'], ['config', '人设配置'], ['memory', '记忆'], ['emoji', '表情'],
  ['api', 'API'], ['dm', '私聊'], ['usage', '用量'], ['logs', '日志'], ['settings', '设置'],
];

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = TABS.map(([id, name]) => `<button data-tab="${id}" class="${id === state.tab ? 'active' : ''}">${name}</button>`).join('');
  nav.onclick = (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
}

async function switchTab(tab) {
  state.tab = tab;
  try { localStorage.setItem('tab', tab); } catch (_) { /* 忽略 */ }
  renderTabs();
  clearTimers();
  const main = $('#main');
  main.innerHTML = '<p class="hint">加载中…</p>';
  try { await VIEWS[tab](main); } catch (e) { main.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
}

async function start() {
  $('#top').hidden = false;
  try { state.tab = localStorage.getItem('tab') || 'status'; } catch (_) { /* 忽略 */ }
  if (!TABS.find((t) => t[0] === state.tab)) state.tab = 'status';
  await loadGuilds();
  switchTab(state.tab);
  if (!state.dotTimer) state.dotTimer = setInterval(refreshDot, 15000);
  refreshDot();
}

async function refreshDot() {
  try { const s = await api('/api/status'); $('#statusDot').className = 'dot ' + s.state; } catch (_) { /* 忽略 */ }
}

const VIEWS = {};

// ============ 状态 ============
VIEWS.status = async (main) => {
  main.innerHTML = '';
  const card = h(`<div class="card"><h2>运行状态 <span id="stBadge"></span></h2><div id="stBody"></div>
    <div class="actions"><button class="btn danger" id="stopBtn">断开</button><button class="btn" id="startBtn">重新连接</button></div></div>`);
  const tokenCard = h(`<div class="card"><h2>Bot Token</h2>
    <div class="field"><label>当前：<span id="tokMask" class="mono">-</span></label>
    <input type="password" id="tokInput" placeholder="粘贴新的 bot token" autocomplete="off"></div>
    <p class="hint">在 Discord Developer Portal → Bot 页面 Reset Token 获取。并在同一页面打开 Server Members Intent 和 Message Content Intent。</p>
    <div class="actions"><button class="btn primary" id="tokSave">保存并连接</button></div></div>`);
  const inviteCard = h(`<div class="card" id="inviteCard" hidden><h2>邀请 bot 加入服务器</h2>
    <p class="hint">用有管理权限的账号打开下面的链接，选择要加入的服务器。</p>
    <div class="actions" style="justify-content:flex-start"><a id="inviteLink" target="_blank" rel="noopener"><button class="btn primary">打开邀请链接</button></a>
    <button class="btn" id="copyInvite">复制链接</button></div></div>`);
  main.append(card, tokenCard, inviteCard);

  const labels = { online: ['在线', 'good'], connecting: ['连接中', 'warn'], stopped: ['未运行', ''], error: ['出错', 'bad'] };
  let invite = '';
  const refresh = async () => {
    const s = await api('/api/status');
    const [txt, cls] = labels[s.state] || [s.state, ''];
    $('#stBadge').innerHTML = `<span class="badge ${cls}">${txt}</span>`;
    const up = s.connected_at ? Math.floor((Date.now() / 1000 - s.connected_at) / 60) : null;
    $('#stBody').innerHTML = `
      ${s.user ? `<div class="row" style="margin-bottom:12px">${s.avatar ? `<img src="${esc(s.avatar)}" style="width:40px;height:40px;border-radius:50%">` : ''}
        <div><div class="title">${esc(s.user)}</div><div class="sub mono">${esc(s.user_id)}</div></div></div>` : ''}
      <div class="stats">
        <div class="stat"><b>${s.guilds ?? '-'}</b><span>服务器</span></div>
        <div class="stat"><b>${s.latency_ms ?? '-'}${s.latency_ms != null ? 'ms' : ''}</b><span>延迟</span></div>
        <div class="stat"><b>${up == null ? '-' : up < 60 ? up + '分' : Math.floor(up / 60) + '时' + (up % 60) + '分'}</b><span>本次连接时长</span></div>
        <div class="stat"><b>${s.queues ?? 0} / ${s.busy_channels ?? 0}</b><span>排队消息 / 处理中频道</span></div>
      </div>
      ${s.error ? `<div class="error-box">${esc(s.error)}</div>` : ''}`;
    $('#tokMask').textContent = s.token_masked || '未设置';
    $('#statusDot').className = 'dot ' + s.state;
    invite = s.invite_url || '';
    $('#inviteCard').hidden = !invite;
    if (invite) $('#inviteLink').href = invite;
  };
  every(4000, () => refresh().catch(() => {}));
  $('#startBtn').onclick = (e) => run(e.target, async () => { await api('/api/bot/start', {}); await sleep(800); await refresh(); }, '正在连接');
  $('#stopBtn').onclick = (e) => run(e.target, async () => { await api('/api/bot/stop', {}); await refresh(); }, '已断开');
  $('#tokSave').onclick = (e) => run(e.target, async () => {
    await api('/api/bot/token', { token: $('#tokInput').value });
    $('#tokInput').value = '';
    await sleep(1500); await refresh(); await loadGuilds();
  }, '已保存，正在连接');
  $('#copyInvite').onclick = async () => { try { await navigator.clipboard.writeText(invite); toast('已复制'); } catch (_) { prompt('复制这个链接', invite); } };
};

// ============ 服务器 ============
VIEWS.guilds = async (main) => {
  await loadGuilds();
  main.innerHTML = '';
  if (!state.guilds.length) { main.append(h(`<div class="card"><p class="hint">还没有服务器。先在「状态」页连接 bot 并邀请它加入服务器。</p></div>`)); return; }
  for (const g of state.guilds) {
    const card = h(`<div class="card">
      <h2><span>${esc(g.name)} ${g.joined ? '' : '<span class="badge bad">已离开</span>'}</span></h2>
      <div class="sub mono hint">${g.id}</div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><b>${fmtNum(g.member_count)}</b><span>成员</span></div>
        <div class="stat"><b>${g.channels.length}</b><span>频道</span></div>
        <div class="stat"><b>${fmtNum(g.message_count)}</b><span>已存消息</span></div>
      </div>
      <div class="actions"><button class="btn" data-a="ch">频道</button><button class="btn" data-a="mem">群友</button></div>
      <div class="detail"></div></div>`);
    const detail = card.querySelector('.detail');
    card.querySelector('[data-a=ch]').onclick = () => renderChannels(detail, g);
    card.querySelector('[data-a=mem]').onclick = () => renderMembers(detail, g.id);
    main.append(card);
  }
};

function renderChannels(box, g) {
  box.innerHTML = `<h3>频道</h3><p class="hint">「导入历史」会从 Discord 拉取比已存消息更早的记录，用于总结记忆。</p>
    <div class="list">${g.channels.map((c) => `<div class="item"><div class="row">
      <div class="grow"><div class="title">#${esc(c.name)}</div><div class="sub mono">${c.id} · ${esc(c.type)}</div></div>
      <input type="number" value="500" min="1" style="width:90px" data-limit="${c.id}">
      <button class="btn small" data-import="${c.id}">导入历史</button></div></div>`).join('')}</div>`;
  $$('[data-import]', box).forEach((b) => {
    b.onclick = () => run(b, async () => {
      const limit = +$(`[data-limit="${b.dataset.import}"]`, box).value || 500;
      const { job_id } = await api(`/api/channels/${b.dataset.import}/import`, { limit });
      const j = await pollJob(job_id, (j) => { b.textContent = `${j.progress}/${j.total}`; });
      b.textContent = '导入历史';
      toast(j.result || '完成');
    });
  });
}

async function renderMembers(box, gid) {
  box.innerHTML = `<h3>群友</h3><input placeholder="搜索昵称、用户名或 ID" id="mq-${gid}"><div class="list" style="margin-top:8px"></div>`;
  const list = box.querySelector('.list');
  const load = async () => {
    const q = box.querySelector('input').value.trim();
    const rows = await api(`/api/guilds/${gid}/members?q=${encodeURIComponent(q)}`);
    list.innerHTML = rows.map((m) => `<div class="item"><div class="row">
      ${m.avatar ? `<img src="${esc(m.avatar)}" style="width:32px;height:32px;border-radius:50%">` : ''}
      <div class="grow"><div class="title">${esc(m.tag)} ${m.is_bot ? '<span class="badge">bot</span>' : ''} ${m.in_guild ? '' : '<span class="badge bad">已退出</span>'}</div>
      <div class="sub">${m.msgs} 条消息${m.former.length ? ' · 曾用名：' + esc(m.former.join('、')) : ''}${m.memory_id ? ' · 有记忆' : ''}</div></div></div></div>`).join('') || '<p class="hint">没有找到</p>';
  };
  let t;
  box.querySelector('input').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  await load();
}

async function pollJob(id, onProgress) {
  for (;;) {
    await sleep(1500);
    const j = await api(`/api/jobs/${id}`);
    if (onProgress) onProgress(j);
    if (j.status === 'done') return j;
    if (j.status === 'error') throw new Error(j.error || '任务失败');
  }
}

// ============ 分层配置 ============
const CFG_GROUPS = [
  ['基本', [
    { k: 'enabled', label: '在这里启用 bot', type: 'bool' },
    { k: 'reply_enabled', label: '被 @ 或被回复时回答', type: 'bool' },
    { k: 'persona', label: '人设（系统提示词）', type: 'textarea' },
  ]],
  ['上下文', [
    { k: 'context_mode', label: '计算方式', type: 'select', options: [['count', '按消息条数'], ['tokens', '按 token 数（估算）']] },
    { k: 'context_size', label: '上下文大小（条数或 token 数）', type: 'number' },
    { k: 'image_limit', label: '进入上下文的图片数量上限（取最近的）', type: 'number' },
  ]],
  ['记忆', [
    { k: 'memory_enabled', label: '把记忆放进系统提示词', type: 'bool' },
  ]],
  ['主动插话', [
    { k: 'interject_enabled', label: '允许主动插话', type: 'bool' },
    { k: 'interject_prob', label: '每批新消息触发插话判断的概率（0~1）', type: 'number', step: '0.01' },
    { k: 'interject_cooldown', label: '冷却时间：bot 上次发言后多少秒内不插话', type: 'number' },
    { k: 'interject_max', label: '窗口内最多插话 / 点反应次数', type: 'number' },
    { k: 'interject_window', label: '窗口长度（分钟）', type: 'number' },
  ]],
  ['聊天模型', [
    { k: 'chat_provider', label: '供应商（留空 = 使用 API 页「聊天回复」的设置）', type: 'provider' },
    { k: 'chat_model', label: '模型名', type: 'text' },
  ]],
];

VIEWS.config = async (main) => {
  await loadGuilds();
  try { state.providers = (await api('/api/providers')).providers; } catch (_) { state.providers = []; }
  main.innerHTML = '';
  const sel = h(`<div class="card"><h2>配置范围</h2>
    <div class="row"><select id="cfgGuild" class="grow"><option value="">全局（所有服务器的默认值）</option>${guildOptions('')}</select>
    <select id="cfgChannel" class="grow" hidden></select></div>
    <p class="hint">下层勾选「继承」时沿用上层设置；取消勾选后，本层的设置会覆盖上层。频道 → 服务器 → 全局。</p></div>`);
  const body = h(`<div></div>`);
  main.append(sel, body);
  const gSel = $('#cfgGuild'); const cSel = $('#cfgChannel');
  const scope = () => (cSel.value ? ['channel', cSel.value] : gSel.value ? ['guild', gSel.value] : ['global', 'global']);
  gSel.onchange = () => {
    const g = state.guilds.find((x) => x.id === gSel.value);
    cSel.hidden = !g;
    cSel.innerHTML = g ? `<option value="">整个服务器</option>` + g.channels.map((c) => `<option value="${c.id}">#${esc(c.name)}</option>`).join('') : '';
    loadScope();
  };
  cSel.onchange = loadScope;
  async function loadScope() {
    const [st, sid] = scope();
    const res = await api(`/api/config?scope_type=${st}&scope_id=${sid}`);
    renderConfig(body, st, sid, res);
  }
  await loadScope();
};

function cfgInput(f, value, disabled) {
  const dis = disabled ? 'disabled' : '';
  if (f.type === 'bool') return `<label class="switch"><input type="checkbox" data-k="${f.k}" ${value ? 'checked' : ''} ${dis}> ${esc(f.label)}</label>`;
  if (f.type === 'textarea') return `<textarea class="tall" data-k="${f.k}" ${dis}>${esc(value)}</textarea>`;
  if (f.type === 'select') return `<select data-k="${f.k}" ${dis}>${f.options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  if (f.type === 'provider') return `<select data-k="${f.k}" ${dis}><option value="">（使用 API 页设置）</option>${state.providers.map((p) => `<option value="${p.id}" ${p.id === value ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  return `<input type="${f.type === 'number' ? 'number' : 'text'}" ${f.step ? `step="${f.step}"` : ''} data-k="${f.k}" value="${esc(value)}" ${dis}>`;
}

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value;
}

function renderConfig(box, st, sid, res) {
  box.innerHTML = '';
  const data = { ...res.data };
  const isGlobal = st === 'global';
  for (const [title, fields] of CFG_GROUPS) {
    const card = h(`<div class="card"><h2>${title}</h2><div class="fields"></div><div class="actions"><button class="btn primary">保存</button></div></div>`);
    const wrap = card.querySelector('.fields');
    for (const f of fields) {
      const own = Object.prototype.hasOwnProperty.call(data, f.k);
      const inherited = !isGlobal && !own;
      const value = own ? data[f.k] : (isGlobal ? res.defaults[f.k] : res.parent[f.k]);
      const row = h(`<div class="field">
        <div class="head">${f.type === 'bool' ? '<span></span>' : `<label>${esc(f.label)}</label>`}
        ${isGlobal ? '' : `<label class="inherit"><input type="checkbox" data-inherit="${f.k}" ${inherited ? 'checked' : ''}>继承</label>`}</div>
        ${cfgInput(f, value, inherited)}</div>`);
      const inh = row.querySelector('[data-inherit]');
      if (inh) {
        inh.onchange = () => {
          const input = row.querySelector('[data-k]');
          input.disabled = inh.checked;
          if (inh.checked) {
            const pv = res.parent[f.k];
            if (input.type === 'checkbox') input.checked = !!pv; else input.value = pv ?? '';
          }
        };
      }
      wrap.append(row);
    }
    card.querySelector('button.primary').onclick = (e) => run(e.target, async () => {
      for (const f of fields) {
        const input = wrap.querySelector(`[data-k="${f.k}"]`);
        const inh = wrap.querySelector(`[data-inherit="${f.k}"]`);
        if (inh && inh.checked) delete data[f.k];
        else data[f.k] = readInput(input);
      }
      await api('/api/config', { scope_type: st, scope_id: sid, data });
    }, '已保存并生效');
    box.append(card);
  }
}

// ============ 记忆 ============
VIEWS.memory = async (main) => {
  await loadGuilds();
  main.innerHTML = '';
  let gid = '';
  try { gid = localStorage.getItem('memGuild') || ''; } catch (_) { /* 忽略 */ }
  if (!gid || (gid !== 'dm' && !state.guilds.find((g) => g.id === gid))) gid = state.guilds[0] ? state.guilds[0].id : 'dm';
  const sel = h(`<div class="card"><h2>选择服务器</h2><select id="memGuild">${guildOptions(gid, { dm: true })}</select>
    <p class="hint">每个服务器的记忆完全独立。「私聊」下是私聊独立记忆（own 模式使用）。</p></div>`);
  const body = h('<div></div>');
  main.append(sel, body);
  const load = async () => {
    gid = $('#memGuild').value;
    try { localStorage.setItem('memGuild', gid); } catch (_) { /* 忽略 */ }
    body.innerHTML = '';
    if (gid !== 'dm') {
      const gcard = h(`<div class="card"><h2>服务器总记忆</h2><div></div></div>`);
      body.append(gcard);
      await memoryEditor(gcard.lastElementChild, 'guild', gid, '');
    }
    const ucard = h(`<div class="card"><h2>${gid === 'dm' ? '私聊记忆' : '群友个人记忆'}</h2>
      <input placeholder="搜索群友（昵称、用户名或 ID）"><div class="list" style="margin-top:8px"></div><div class="editor"></div></div>`);
    body.append(ucard);
    const list = ucard.querySelector('.list');
    const editor = ucard.querySelector('.editor');
    const loadList = async () => {
      const q = ucard.querySelector('input').value.trim();
      const rows = await api(`/api/guilds/${gid}/members?q=${encodeURIComponent(q)}`);
      list.innerHTML = rows.slice(0, q ? 50 : 15).map((m) => `<div class="item clickable" data-uid="${m.user_id}">
        <div class="title">${esc(m.tag)} ${m.memory_id ? '<span class="badge good">有记忆</span>' : ''}</div>
        <div class="sub">${m.msgs} 条消息${m.former.length ? ' · 曾用名：' + esc(m.former.join('、')) : ''}</div></div>`).join('') || '<p class="hint">没有找到群友</p>';
      $$('[data-uid]', list).forEach((it) => {
        it.onclick = async () => {
          list.innerHTML = `<div class="item"><button class="btn small" id="backList">← 返回列表</button></div>`;
          $('#backList', list).onclick = () => { editor.innerHTML = ''; loadList(); };
          await memoryEditor(editor, gid === 'dm' ? 'dm' : 'user', gid, it.dataset.uid);
        };
      });
    };
    let t;
    ucard.querySelector('input').oninput = () => { clearTimeout(t); editor.innerHTML = ''; t = setTimeout(loadList, 300); };
    await loadList();
  };
  $('#memGuild').onchange = load;
  await load();
};

async function memoryEditor(box, scope, gid, uid) {
  const res = await api(`/api/memory/get?scope=${scope}&guild_id=${gid}&user_id=${uid}`);
  let mem = res.memory;
  const g = state.guilds.find((x) => x.id === gid);
  box.innerHTML = '';
  const el = h(`<div>
    ${res.tag ? `<p class="title" style="margin:4px 0 10px">${esc(res.tag)}</p>` : ''}
    <textarea class="tall" placeholder="还没有记忆，可以手动填写，或用下方的区间总结生成"></textarea>
    <p class="hint upd"></p>
    <div class="actions"><button class="btn" data-a="ver">版本历史</button><button class="btn primary" data-a="save">保存</button></div>
    <details><summary>按消息区间总结</summary>
      <div style="padding-top:8px">
        ${g ? `<div class="field"><label>频道（不选 = 全部频道）</label><div class="checks">${g.channels.map((c) => `<label class="switch"><input type="checkbox" value="${c.id}">#${esc(c.name)}</label>`).join('')}</div></div>` : ''}
        <div class="row"><div class="field grow"><label>开始时间</label><input type="datetime-local" data-r="start"></div>
        <div class="field grow"><label>结束时间</label><input type="datetime-local" data-r="end"></div></div>
        <div class="field"><label>方式</label><select data-r="mode"><option value="merge">合并到现有记忆</option><option value="replace">忽略现有记忆，重新生成</option></select></div>
        <div class="row"><button class="btn" data-a="count">统计消息数</button><span class="hint cnt"></span></div>
        <div class="actions"><button class="btn primary" data-a="sum">开始总结</button></div>
        <div class="draft" hidden>
          <h3>草稿（可以先修改，确认后才写入）</h3>
          <textarea class="tall"></textarea>
          <div class="actions"><button class="btn" data-a="discard">放弃</button><button class="btn primary" data-a="confirm">确认写入</button></div>
        </div>
      </div>
    </details></div>`);
  box.append(el);
  const ta = el.querySelector('textarea');
  const showMem = () => {
    ta.value = mem ? mem.content : '';
    el.querySelector('.upd').textContent = mem ? `最后更新：${fmtTs(mem.updated_at)}` : '';
  };
  showMem();
  const toTs = (v) => (v ? new Date(v).getTime() / 1000 : null);
  const rangeBody = () => ({
    scope, guild_id: gid, user_id: uid,
    channel_ids: $$('.checks input:checked', el).map((c) => c.value),
    start: toTs(el.querySelector('[data-r=start]').value),
    end: toTs(el.querySelector('[data-r=end]').value),
    mode: el.querySelector('[data-r=mode]').value,
  });
  const btn = (a) => el.querySelector(`[data-a=${a}]`);
  btn('save').onclick = (e) => run(e.target, async () => {
    mem = (await api('/api/memory/save', { scope, guild_id: gid, user_id: uid, content: ta.value, note: '手动修改' })).memory;
    showMem();
  }, '已保存');
  btn('ver').onclick = () => {
    if (!mem) { toast('还没有记忆'); return; }
    showVersions(mem, (m) => { mem = m; showMem(); });
  };
  btn('count').onclick = (e) => run(e.target, async () => {
    const r = await api('/api/memory/count', rangeBody());
    el.querySelector('.cnt').textContent = `共 ${r.total} 条消息` + (r.user !== undefined ? `，其中该群友 ${r.user} 条` : '');
  });
  const draft = el.querySelector('.draft');
  const draftTa = draft.querySelector('textarea');
  btn('sum').onclick = (e) => run(e.target, async () => {
    const { job_id } = await api('/api/memory/summarize', rangeBody());
    const j = await pollJob(job_id, (j) => { e.target.textContent = j.total ? `总结中 ${j.progress}/${j.total}` : '总结中…'; });
    e.target.textContent = '开始总结';
    draftTa.value = j.result;
    draft.hidden = false;
    toast(`总结完成，共 ${j.messages} 条消息`);
  }).finally(() => { btn('sum').textContent = '开始总结'; });
  btn('discard').onclick = () => { draft.hidden = true; draftTa.value = ''; };
  btn('confirm').onclick = (e) => run(e.target, async () => {
    mem = (await api('/api/memory/save', { scope, guild_id: gid, user_id: uid, content: draftTa.value, note: '区间总结' })).memory;
    showMem();
    draft.hidden = true;
  }, '已写入记忆');
}

async function showVersions(mem, onRestore) {
  const rows = await api(`/api/memory/versions?memory_id=${mem.id}`);
  const box = h(`<div><h2 style="margin-top:0">版本历史</h2><div class="list"></div><div class="view"></div>
    <div class="actions"><button class="btn" data-close>关闭</button></div></div>`);
  const m = modal(box);
  box.querySelector('[data-close]').onclick = () => m.remove();
  const list = box.querySelector('.list');
  const view = box.querySelector('.view');
  list.innerHTML = rows.map((v, i) => `<div class="item"><div class="row"><div class="grow">
    <div class="title">${fmtTs(v.created_at)} ${i === 0 ? '<span class="badge good">当前</span>' : ''}</div><div class="sub">${esc(v.note || '')} · ${v.content.length} 字</div></div>
    <button class="btn small" data-view="${i}">查看</button>
    ${i < rows.length - 1 ? `<button class="btn small" data-diff="${i}">对比上一版</button>` : ''}
    ${i > 0 ? `<button class="btn small" data-restore="${v.id}">回滚</button>` : ''}</div></div>`).join('');
  $$('[data-view]', list).forEach((b) => { b.onclick = () => { view.innerHTML = `<h3>内容</h3><div class="diff">${esc(rows[+b.dataset.view].content)}</div>`; }; });
  $$('[data-diff]', list).forEach((b) => {
    b.onclick = () => { const i = +b.dataset.diff; view.innerHTML = `<h3>与上一版的差异</h3><div class="diff">${diffHtml(rows[i + 1].content, rows[i].content)}</div>`; };
  });
  $$('[data-restore]', list).forEach((b) => {
    b.onclick = () => run(b, async () => {
      if (!confirm('回滚到这个版本？当前内容会作为历史版本保留。')) return;
      const r = await api('/api/memory/restore', { version_id: +b.dataset.restore });
      onRestore(r.memory);
      m.remove();
      toast('已回滚');
    });
  });
}

function diffHtml(a, b) {
  const x = a.split('\n'); const y = b.split('\n');
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
  return out.join('\n');
}

// ============ 表情 ============
VIEWS.emoji = async (main) => {
  await loadGuilds();
  main.innerHTML = '';
  const top = h(`<div class="card"><h2>表情与贴纸</h2>
    <div class="row"><select id="emGuild" class="grow">${guildOptions('', { all: true })}</select>
    <button class="btn" id="retagAll">全部重新打标</button></div>
    <p class="hint">新表情会自动用「表情打标」模型生成描述（需在 API 页配置支持图片的模型）。手动修改过的描述不会被自动覆盖。</p></div>`);
  const listCard = h(`<div class="card"><div class="emoji-grid"></div></div>`);
  main.append(top, listCard);
  const grid = listCard.querySelector('.emoji-grid');
  const load = async () => {
    const rows = await api(`/api/emojis?guild_id=${$('#emGuild').value}`);
    grid.innerHTML = rows.map((e) => `<div class="emoji">
      <img src="${esc(e.url)}" loading="lazy" alt="">
      <div><div class="row"><span class="title grow">${esc(e.name)}</span>
        ${e.kind === 'sticker' ? '<span class="badge">贴纸</span>' : ''}
        ${e.description == null ? (e.fail >= 3 ? '<span class="badge bad">打标失败</span>' : '<span class="badge warn">待打标</span>') : e.desc_manual ? '<span class="badge">手动</span>' : ''}</div>
        <div class="sub">${esc(e.guild_name || '')} · 使用 ${e.uses} 次</div>
        <div class="row" style="margin-top:6px"><input class="grow" data-desc="${e.id}" value="${esc(e.description || '')}" placeholder="描述">
        <button class="btn small" data-save="${e.id}">保存</button><button class="btn small" data-retag="${e.id}">重新打标</button></div></div></div>`).join('') || '<p class="hint">还没有表情</p>';
    $$('[data-save]', grid).forEach((b) => { b.onclick = () => run(b, () => api(`/api/emojis/${b.dataset.save}`, { description: $(`[data-desc="${b.dataset.save}"]`, grid).value }), '已保存'); });
    $$('[data-retag]', grid).forEach((b) => { b.onclick = () => run(b, async () => { await api(`/api/emojis/${b.dataset.retag}/retag`, {}); await load(); }, '已加入打标队列'); });
  };
  $('#emGuild').onchange = load;
  $('#retagAll').onclick = (e) => run(e.target, async () => {
    if (!confirm('重新给所有表情打标？手动修改的描述也会被覆盖。')) return;
    await api('/api/emojis/retag_all', { guild_id: $('#emGuild').value }); await load();
  }, '已加入打标队列');
  await load();
};

// ============ API ============
VIEWS.api = async (main) => {
  const res = await api('/api/providers');
  let providers = res.providers.map((p) => ({ ...p, api_key: '' }));
  main.innerHTML = '';
  const pCard = h(`<div class="card"><h2>供应商</h2><div class="plist"></div>
    <div class="actions"><button class="btn" id="addP">添加供应商</button><button class="btn primary" id="saveP">保存</button></div>
    <p class="hint">API 地址示例：OpenAI 兼容填 https://你的反代/v1，Claude 格式填 https://你的反代（会自动补上 /v1/messages）。</p></div>`);
  const mCard = h(`<div class="card"><h2>模型分配</h2><div class="mlist"></div><div class="actions"><button class="btn primary" id="saveM">保存</button></div></div>`);
  main.append(pCard, mCard);
  const plist = pCard.querySelector('.plist');

  const renderP = () => {
    plist.innerHTML = providers.map((p, i) => `<div class="provider" data-i="${i}">
      <div class="row"><div class="field grow"><label>名称</label><input data-f="name" value="${esc(p.name || '')}"></div>
      <div class="field grow"><label>格式</label><select data-f="format"><option value="openai" ${p.format !== 'claude' ? 'selected' : ''}>OpenAI 兼容</option><option value="claude" ${p.format === 'claude' ? 'selected' : ''}>Claude</option></select></div></div>
      <div class="field"><label>API 地址</label><input data-f="base_url" value="${esc(p.base_url || '')}" placeholder="https://..."></div>
      <div class="field"><label>API Key ${p.api_key_masked ? `（当前 ${esc(p.api_key_masked)}，留空不修改）` : ''}</label><input type="password" data-f="api_key" value="${esc(p.api_key || '')}" autocomplete="off"></div>
      <div class="row"><input class="grow" data-f="test_model" placeholder="测试用的模型名" value="${esc(p.test_model || '')}">
      <button class="btn small" data-test="${i}">测试连接</button><button class="btn small danger" data-del="${i}">删除</button></div>
      <p class="hint" data-result="${i}"></p></div>`).join('') || '<p class="hint">还没有供应商，点「添加供应商」。</p>';
    $$('.provider', plist).forEach((box) => {
      const i = +box.dataset.i;
      $$('[data-f]', box).forEach((inp) => { inp.oninput = () => { providers[i][inp.dataset.f] = inp.value; }; });
    });
    $$('[data-del]', plist).forEach((b) => { b.onclick = () => { providers.splice(+b.dataset.del, 1); renderP(); }; });
    $$('[data-test]', plist).forEach((b) => {
      b.onclick = () => run(b, async () => {
        const p = providers[+b.dataset.test];
        const r = await api('/api/providers/test', { provider: { id: p.id, format: p.format, base_url: p.base_url, api_key: p.api_key }, model: p.test_model || '' });
        $(`[data-result="${b.dataset.test}"]`, plist).textContent = (r.ok ? '✅ ' : '❌ ') + r.result;
      });
    });
  };
  renderP();
  $('#addP').onclick = () => { providers.push({ name: '新供应商', format: 'openai', base_url: '', api_key: '' }); renderP(); };
  $('#saveP').onclick = (e) => run(e.target, async () => {
    const r = await api('/api/providers', { providers: providers.map(({ id, name, format, base_url, api_key }) => ({ id, name, format, base_url, api_key })) });
    providers = r.providers.map((p) => ({ ...p, api_key: '' }));
    renderP(); renderM();
  }, '已保存');

  const models = res.models;
  const mlist = mCard.querySelector('.mlist');
  const renderM = () => {
    mlist.innerHTML = Object.entries(res.purposes).map(([k, label]) => {
      const m = models[k] || {};
      return `<div class="provider" data-p="${k}"><div class="title" style="margin-bottom:8px">${esc(label)}</div>
        <div class="row"><div class="field grow"><label>供应商</label><select data-m="provider"><option value="">（未设置）</option>${providers.filter((p) => p.id).map((p) => `<option value="${p.id}" ${p.id === m.provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field grow"><label>模型名</label><input data-m="model" value="${esc(m.model || '')}"></div></div>
        <div class="row"><div class="field grow"><label>最大输出 tokens</label><input type="number" data-m="max_tokens" value="${m.max_tokens ?? 1024}"></div>
        <div class="field grow"><label>温度</label><input type="number" step="0.05" data-m="temperature" value="${m.temperature ?? 0.9}"></div></div></div>`;
    }).join('');
  };
  renderM();
  $('#saveM').onclick = (e) => run(e.target, async () => {
    const out = {};
    $$('[data-p]', mlist).forEach((box) => {
      out[box.dataset.p] = {};
      $$('[data-m]', box).forEach((inp) => { out[box.dataset.p][inp.dataset.m] = inp.value; });
    });
    await api('/api/models', { models: out });
    Object.assign(models, out);
  }, '已保存并生效');
};

// ============ 私聊 ============
VIEWS.dm = async (main) => {
  await loadGuilds();
  const d = await api('/api/dm');
  main.innerHTML = '';
  const card = h(`<div class="card"><h2>私聊设置</h2>
    <div class="field"><label>允许私聊的 Discord 用户 ID（每行一个，其他人私聊 bot 会被忽略）</label><textarea id="dmWl" style="min-height:80px">${esc(d.whitelist.join('\n'))}</textarea></div>
    <div class="field"><label>模式</label><select id="dmMode">
      <option value="guild" ${d.mode === 'guild' ? 'selected' : ''}>加载某个服务器的人设和记忆</option>
      <option value="persona" ${d.mode === 'persona' ? 'selected' : ''}>只用人设，不加载记忆</option>
      <option value="own" ${d.mode === 'own' ? 'selected' : ''}>私聊独立记忆</option></select></div>
    <div class="field"><label>人设 / 记忆来源服务器</label><select id="dmGuild">${guildOptions(d.guild_id, { all: true, allLabel: '全局人设' })}</select></div>
    <p class="hint">也可以在私聊里发送 <span class="mono">!mode</span> 查看和切换。私聊内容不会写进任何服务器的记忆；独立记忆在「记忆」页选择「私聊」编辑。</p>
    <div class="actions"><button class="btn primary" id="dmSave">保存</button></div></div>`);
  main.append(card);
  $('#dmSave').onclick = (e) => run(e.target, () => api('/api/dm', { whitelist: $('#dmWl').value, mode: $('#dmMode').value, guild_id: $('#dmGuild').value }), '已保存并生效');
};

// ============ 用量 ============
VIEWS.usage = async (main) => {
  main.innerHTML = '';
  const top = h(`<div class="card"><h2>用量统计 <select id="usDays" style="width:auto"><option value="1">今天</option><option value="7" selected>7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></h2><div id="usBody"></div></div>`);
  const priceCard = h(`<div class="card"><h2>模型单价（每 100 万 tokens）</h2><div id="prBody"></div><div class="actions"><button class="btn primary" id="prSave">保存</button></div></div>`);
  main.append(top, priceCard);
  const table = (title, rows) => `<h3>${title}</h3><div class="table-wrap"><table><tr><th></th><th>调用</th><th>输入</th><th>输出</th><th>缓存读</th><th>费用</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.calls}${r.fails ? ` <span class="badge bad">${r.fails} 失败</span>` : ''}</td><td>${fmtNum(r.input)}</td><td>${fmtNum(r.output)}</td><td>${fmtNum(r.cache_read)}</td><td>${r.cost.toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">暂无数据</td></tr>'}</table></div>`;
  const load = async () => {
    const u = await api(`/api/usage?days=${$('#usDays').value}`);
    const t = u.total;
    const max = Math.max(1, ...u.daily.map((d) => d.input + d.output));
    $('#usBody').innerHTML = `<div class="stats">
      <div class="stat"><b>${fmtNum(t.calls)}</b><span>调用次数</span></div>
      <div class="stat"><b>${fmtNum(t.input)}</b><span>输入 tokens</span></div>
      <div class="stat"><b>${fmtNum(t.output)}</b><span>输出 tokens</span></div>
      <div class="stat"><b>${fmtNum(t.cache_read)}</b><span>缓存命中 tokens</span></div>
      <div class="stat"><b>${t.cost.toFixed(4)}</b><span>估算费用</span></div></div>
      ${u.daily.length > 1 ? `<h3>每日 tokens</h3><div class="bars">${u.daily.map((d) => `<div class="b" style="height:${((d.input + d.output) / max) * 100}%" title="${d.key}: ${fmtNum(d.input + d.output)}"></div>`).join('')}</div>
      <div class="bars-labels">${u.daily.map((d) => `<span>${d.key}</span>`).join('')}</div>` : ''}
      ${table('按服务器', u.by_guild)}${table('按模型', u.by_model)}${table('按用途', u.by_purpose)}`;
  };
  $('#usDays').onchange = load;
  await load();
  const pr = await api('/api/prices');
  const allModels = [...new Set([...pr.models, ...Object.keys(pr.prices)])];
  const cols = [['input', '输入'], ['output', '输出'], ['cache_read', '缓存读'], ['cache_write', '缓存写']];
  $('#prBody').innerHTML = allModels.map((m) => `<div class="provider" data-model="${esc(m)}"><div class="title mono" style="margin-bottom:6px">${esc(m)}</div>
    <div class="row">${cols.map(([k, l]) => `<div class="field grow" style="flex-basis:90px"><label>${l}</label><input type="number" step="0.001" data-k="${k}" value="${(pr.prices[m] || {})[k] ?? ''}"></div>`).join('')}</div></div>`).join('') || '<p class="hint">有调用记录后，这里会列出用过的模型。</p>';
  $('#prSave').onclick = (e) => run(e.target, async () => {
    const prices = {};
    $$('[data-model]', priceCard).forEach((box) => {
      prices[box.dataset.model] = {};
      $$('[data-k]', box).forEach((i) => { prices[box.dataset.model][i.dataset.k] = +i.value || 0; });
    });
    await api('/api/prices', { prices });
    await load();
  }, '已保存');
};

// ============ 日志 ============
VIEWS.logs = async (main) => {
  main.innerHTML = '';
  const live = h(`<div class="card"><h2>实时日志 <label class="switch" style="font-weight:400"><input type="checkbox" id="autoScroll" checked>自动滚动</label></h2><div class="logbox" id="logBox"></div></div>`);
  const errs = h(`<div class="card"><h2>报错记录 <button class="btn small danger" id="clearErr">清空</button></h2><div class="list" id="errList"></div></div>`);
  main.append(live, errs);
  let after = 0;
  const box = $('#logBox');
  every(2000, async () => {
    try {
      const rows = await api(`/api/logs?after=${after}`);
      if (!rows.length) return;
      after = rows[rows.length - 1].seq;
      const frag = document.createDocumentFragment();
      for (const r of rows) {
        const d = document.createElement('div');
        d.className = r.level;
        d.textContent = `${new Date(r.ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })} ${r.level[0]} ${r.logger}: ${r.message}`;
        frag.append(d);
      }
      box.append(frag);
      while (box.childElementCount > 1500) box.firstElementChild.remove();
      if ($('#autoScroll') && $('#autoScroll').checked) box.scrollTop = box.scrollHeight;
    } catch (_) { /* 忽略 */ }
  });
  const loadErr = async () => {
    const rows = await api('/api/errors');
    $('#errList').innerHTML = rows.map((r) => `<div class="item"><div class="sub">${fmtTs(r.ts)} · ${esc(r.logger)}</div><div class="title" style="font-weight:500">${esc(r.message)}</div>
      ${r.trace ? `<details><summary>堆栈</summary><pre class="trace">${esc(r.trace)}</pre></details>` : ''}</div>`).join('') || '<p class="hint">没有报错</p>';
  };
  $('#clearErr').onclick = (e) => run(e.target, async () => { await api('/api/errors/clear', {}); await loadErr(); }, '已清空');
  await loadErr();
};

// ============ 设置 ============
const GENERAL_FIELDS = [
  ['timezone', '时区（用于时间戳）', 'text'],
  ['debounce_seconds', '防抖等待（秒）：收到消息后等多久没有新消息再处理', 'number'],
  ['gap_minutes', '相邻消息间隔超过多少分钟时标注时间间隔', 'number'],
  ['emoji_candidates', '提供给模型的候选表情数量', 'number'],
  ['max_reactions', '每次最多点几个反应', 'number'],
  ['judge_context_lines', '插话判断时给小模型看的最近消息条数', 'number'],
  ['respond_to_bots', '回应其他 bot 的消息', 'bool'],
];

VIEWS.settings = async (main) => {
  const g = await api('/api/general');
  main.innerHTML = '';
  const card = h(`<div class="card"><h2>通用设置</h2>${GENERAL_FIELDS.map(([k, l, t]) => t === 'bool'
    ? `<div class="field"><label class="switch"><input type="checkbox" data-k="${k}" ${g.data[k] ? 'checked' : ''}>${l}</label></div>`
    : `<div class="field"><label>${l}</label><input type="${t}" step="any" data-k="${k}" value="${esc(g.data[k])}"></div>`).join('')}
    <div class="actions"><button class="btn primary" id="genSave">保存</button></div></div>`);
  const pw = h(`<div class="card"><h2>修改后台密码</h2>
    <div class="field"><label>旧密码</label><input type="password" id="pwOld" autocomplete="current-password"></div>
    <div class="field"><label>新密码（至少 8 位）</label><input type="password" id="pwNew" autocomplete="new-password"></div>
    <div class="actions"><button class="btn primary" id="pwSave">修改</button></div></div>`);
  const out = h(`<div class="card"><h2>账户</h2><div class="actions" style="justify-content:flex-start"><button class="btn danger" id="logout">退出登录</button></div></div>`);
  main.append(card, pw, out);
  $('#genSave').onclick = (e) => run(e.target, async () => {
    const data = {};
    $$('[data-k]', card).forEach((i) => { data[i.dataset.k] = readInput(i); });
    await api('/api/general', { data });
  }, '已保存并生效');
  $('#pwSave').onclick = (e) => run(e.target, async () => {
    await api('/api/password', { old: $('#pwOld').value, new: $('#pwNew').value });
    toast('密码已修改，请重新登录');
    showLogin();
  });
  $('#logout').onclick = async () => { await api('/api/logout', {}); showLogin(); };
};

// ============ 启动 ============
(async () => {
  try {
    const s = await api('/api/session');
    if (s.ok) start(); else showLogin();
  } catch (_) { showLogin(); }
})();
