// Shared by every Pin Master page: talks to the web app, keeps the session, small DOM helpers.
(function () {
  var CFG = window.PM_CONFIG || {};
  var KEY = 'pm.session';
  var mem = null;

  function store() { try { return window.sessionStorage; } catch (e) { return null; } }
  function getSession() {
    var s = store();
    if (!s) return mem;
    try { return JSON.parse(s.getItem(KEY) || 'null'); } catch (e) { return mem; }
  }
  function setSession(v) {
    mem = v;
    var s = store();
    try { if (s) { if (v) s.setItem(KEY, JSON.stringify(v)); else s.removeItem(KEY); } } catch (e) {}
  }
  function pref(k, v) {
    var s = store();
    try { if (s) { if (v === undefined) return s.getItem('pm.' + k); s.setItem('pm.' + k, v); } } catch (e) {}
    return null;
  }

  // Loading overlay: shown when a call takes longer than 0.4 s, so quick calls do not flicker.
  // Pass {quiet: true} for background work (auto refresh, score sync) that must not block the screen.
  var busyN = 0, busyTimer = null, slowTimer = null, ov = null;
  function overlayOn() {
    if (!document.body) return;
    if (!document.getElementById('pm-ov-css')) {
      var st = document.createElement('style'); st.id = 'pm-ov-css';
      st.textContent = '#pm-ov{position:fixed;inset:0;z-index:9999;background:rgba(11,42,91,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
        '#pm-ov .b{background:#fff;color:#0B1B33;border-radius:14px;padding:22px 26px;max-width:340px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3);font:600 16px Inter,Arial,sans-serif}' +
        '#pm-ov .sp{width:38px;height:38px;border:4px solid #D9E0EC;border-top-color:#F2A93B;border-radius:50%;margin:0 auto 12px;animation:pmspin .8s linear infinite}' +
        '#pm-ov .s{font:400 14px Inter,Arial,sans-serif;color:#4A5B78;margin-top:6px;min-height:20px}' +
        '@keyframes pmspin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){#pm-ov .sp{animation:none}}';
      document.head.appendChild(st);
    }
    ov = document.createElement('div'); ov.id = 'pm-ov'; ov.setAttribute('role', 'status'); ov.setAttribute('aria-live', 'polite');
    ov.innerHTML = '<div class="b"><div class="sp" aria-hidden="true"></div><div>Working…</div><div class="s"></div></div>';
    document.body.appendChild(ov);
    slowTimer = setTimeout(function () { var m = ov && ov.querySelector('.s'); if (m) m.textContent = 'Still working. The server is slow, please wait and do not close this page.'; }, 6000);
  }
  function overlayOff() {
    clearTimeout(busyTimer); clearTimeout(slowTimer); busyTimer = null;
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = null;
  }
  function busyStart() { busyN++; if (busyN === 1) busyTimer = setTimeout(overlayOn, 400); }
  function busyEnd() { busyN = Math.max(0, busyN - 1); if (busyN === 0) overlayOff(); }

  // One call to the script. Resolves with data; rejects with {code, message}.
  async function api(action, params, opts) {
    var quiet = !!(opts && opts.quiet);
    if (!quiet) busyStart();
    try { return await apiCall(action, params, opts); } finally { if (!quiet) busyEnd(); }
  }
  async function apiCall(action, params, opts) {
    var sess = getSession();
    var res;
    try {
      var r = await fetch(CFG.WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, params: params || {}, token: (opts && opts.token) || (sess && sess.token) })
      });
      res = await r.json();
    } catch (e) {
      throw { code: 'network', message: 'Cannot reach the server. Check your connection and try again.' };
    }
    if (!res.ok) {
      var err = res.error || { code: 'server', message: 'Something went wrong.' };
      if (err.code === 'auth' && sess && action !== 'auth.login' && action !== 'auth.changePin') setSession(null);
      throw err;
    }
    return res.data;
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  function fmtTime(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  }

  function confirmDialog(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var dlg = h('dialog', { 'aria-labelledby': 'dlg-t' });
      var done = function (v) { dlg.close(); dlg.remove(); resolve(v); };
      dlg.append(h('div', { class: 'dlg' },
        h('h2', { class: 'pm-h', id: 'dlg-t', style: 'font-size:26px', text: title }),
        h('p', { text: text, style: 'font-size:15px;color:#33445C' }),
        h('div', { class: 'dlg-act' },
          h('button', { class: 'pm-btn', type: 'button', onClick: function () { done(false); } }, 'Cancel'),
          h('button', { class: 'pm-btn ' + (danger ? 'pm-btn--danger' : 'pm-btn--pri'), type: 'button', onClick: function () { done(true); } }, okLabel || 'OK'))));
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  // ---------- navigation: which page to open, and where the tournament id lives (the web address: ?t=) ----------
  var PAGES = ['hub.html', 'tournament.html', 'setup.html', 'users.html', 'participants.html', 'lanes.html', 'scores.html', 'leaderboard.html', 'reports.html', 'official.html'];
  var STATUS = { draft: 'Draft', regopen: 'Registration open', regclosed: 'Registration closed', live: 'Live', paused: 'Paused', ended: 'Ended' };
  function q(name) { try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; } }
  function here() { return (location.pathname.split('/').pop() || '') + location.search; }
  function goLogin(expired) { location.replace('login.html?next=' + encodeURIComponent(here()) + (expired ? '&expired=1' : '')); }
  function safeNext(n) {
    n = String(n || '');
    return PAGES.indexOf(n.split('?')[0]) >= 0 && /^[a-z]+\.html(\?[A-Za-z0-9_=&.\-]*)?$/.test(n) ? n : '';
  }
  function home(user) { return user.role === 'admin' ? 'hub.html' : 'tournament.html?t=' + encodeURIComponent(user.tournament_id || ''); }
  // Where to go after signing in: the page the person asked for, else their home page. Non-admins only ever get their tournament page.
  function landing(user) {
    var n = safeNext(q('next'));
    if (n && (user.role === 'admin' || n.indexOf('tournament.html') === 0 || n.indexOf('participants.html') === 0 || n.indexOf('lanes.html') === 0 || n.indexOf('scores.html') === 0 || n.indexOf('leaderboard.html') === 0 || n.indexOf('reports.html') === 0)) return n;
    return home(user);
  }
  function link(page, id, extra) { return page + (id ? '?t=' + encodeURIComponent(id) + (extra ? '&' + extra : '') : (extra ? '?' + extra : '')); }
  function setT(id) { try { if (window.history && history.replaceState) { var u = new URL(location.href); if (id) u.searchParams.set('t', id); else u.searchParams.delete('t'); u.searchParams.delete('new'); history.replaceState(null, '', u.pathname.split('/').pop() + u.search); } } catch (e) {} }
  function fmtDates(s, e) {
    function f(x, withYear, withMonth) { var d = new Date(x + 'T00:00:00'); if (isNaN(d)) return ''; return d.toLocaleDateString('en-GB', { day: 'numeric', month: withMonth === false ? undefined : 'short', year: withYear ? 'numeric' : undefined }); }
    if (!s) return 'Dates not set';
    if (!e || e === s) return f(s, true);
    return f(s, false) + ' to ' + f(e, true);
  }
  // The one button on a tournament card.
  function cardAction(r) {
    var id = r.tournament_id;
    if (r.status === 'draft') return r.setup_complete ? { label: 'Continue Setup', href: link('setup.html', id) } : { label: 'Complete Setup', href: link('setup.html', id), incomplete: true };
    if (r.status === 'live' || r.status === 'paused') return { label: 'Manage Tournament', href: link('tournament.html', id) };
    if (r.status === 'ended') return { label: 'View Results', href: link('tournament.html', id) };
    return { label: 'Open Tournament', href: link('tournament.html', id) };
  }

  window.PM = { api: api, h: h, getSession: getSession, setSession: setSession, pref: pref, fmtTime: fmtTime, confirmDialog: confirmDialog,
    q: q, goLogin: goLogin, landing: landing, home: home, link: link, setT: setT, fmtDates: fmtDates, cardAction: cardAction, STATUS: STATUS };
})();
