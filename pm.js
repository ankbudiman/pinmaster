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

  // One call to the script. Resolves with data; rejects with {code, message}.
  async function api(action, params, opts) {
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
  var PAGES = ['hub.html', 'tournament.html', 'setup.html', 'users.html'];
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
    if (n && (user.role === 'admin' || n.indexOf('tournament.html') === 0)) return n;
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
