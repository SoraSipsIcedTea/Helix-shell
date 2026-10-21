/* Helix-Desktop: Oberfläche – Leiste, Dock, Startseite, Starter, Übersicht, Schnelleinstellungen,
 * Brücke zu Android (window.__helixDesktop) und zu den Apps (postMessage). */
(function () {
  'use strict';
  var HX = window.HX, el = HX.el, icon = HX.icon, Apps = HX.apps, WM = HX.wm;
  var H = HX.native;
  var $ = function (id) { return document.getElementById(id); };

  var state = { launcher: false, overview: false, mobile: false, settings: null, battery: null };
  var shell = HX.shell = {};

  /* ================================================================== Start */
  function boot() {
    // Sicherheitsnetz: das Startbild verschwindet auch, wenn beim Start etwas schiefgeht.
    setTimeout(function () { var b = $('boot'); if (b) b.classList.add('gone'); }, 5000);
    WM.init();
    buildPanel();
    buildDock();
    HX.prefs.load().then(function () {
      applyTheme();
      applyWallpaper();
      applyMode();
      return Apps.refresh();
    }).then(function () {
      [renderDock, renderDesk, restoreSession, hello, handleStartParams].forEach(function (fn) {
        try { fn(); } catch (e) { console.error('[Helix] Start:', fn.name, e); }
      });
      if (!HX.online) HX.notify({ title: 'Ohne Helix-Server', body: 'Der Desktop läuft als Vorschau. Apps, Dateien und Updates brauchen die Helix-App.', log: false, ms: 8000 });
      setTimeout(function () { $('boot').classList.add('gone'); }, 120);
      setTimeout(function () { $('boot').remove(); }, 700);
    });
    if (H) HX.api('/api/system/settings').then(function (s) { state.settings = s; }).catch(function () { });
    tick();
    battery();
    window.addEventListener('online', renderStatus);
    window.addEventListener('offline', renderStatus);
    window.addEventListener('resize', applyMode);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    HX.on('apps', function () { renderDock(); renderDesk(); if (state.launcher) renderLauncher(); });
    HX.on('windows', function () { renderDock(); if (state.overview) layoutOverview(); renderNavBadge(); });
    HX.on('focus', function (w) { renderActive(w); renderDock(); });
    HX.on('title', function (w) { if (w === WM.focused()) renderActive(w); });
    HX.on('session', saveSession);
    HX.on('prefs', function (k) {
      if (k === 'theme') applyTheme();
      if (k === 'wallpaper') applyWallpaper();
      if (k === 'mode') applyMode();
      if (k === 'dock') renderDock();
      if (k === 'pins' || k === 'desktopIcons') renderDesk();
      if (k === 'seconds') tick();
    });
  }

  /* ================================================================== Darstellung */
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (HX.prefs.get('theme') === 'auto') applyTheme(); });
  function themeNow() {
    var t = HX.prefs.get('theme');
    if (t === 'auto') return dark && !dark.matches ? 'light' : 'dark';
    return t === 'light' ? 'light' : 'dark';
  }
  function applyTheme() {
    var t = themeNow();
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F6F8FB' : '#0B1020');
    WM.wins.forEach(function (w) {
      if (w.app.system) applyThemeTo(w.frame.contentWindow);
      else WM.post(w, 'theme', { theme: t }, 100);
    });
    if (H) HX.api('/api/system/bars', { method: 'POST', json: { light: t === 'light' } }).catch(function () { });
    HX.emit('theme', t);
  }
  function applyThemeTo(cw) {
    try { cw.document.documentElement.setAttribute('data-theme', themeNow()); } catch (e) { }
  }
  HX.on('theme-apply', applyThemeTo);
  HX.theme = themeNow;

  var WALLS = HX.wallpapers = [
    { id: 'nacht', name: 'Nacht' }, { id: 'gezeiten', name: 'Gezeiten' }, { id: 'glut', name: 'Glut' }, { id: 'papier', name: 'Papier' }
  ];
  function applyWallpaper() {
    var w = HX.prefs.get('wallpaper') || 'nacht', bg;
    if (/^#[0-9a-f]{3,8}$/i.test(w)) bg = w;
    else if (/^(https?:|data:|blob:)/.test(w)) bg = 'url("' + w.replace(/"/g, '%22') + '")';
    else {
      var ok = WALLS.some(function (x) { return x.id === w; });
      bg = 'url("wallpapers/' + (ok ? w : 'nacht') + '.jpg")';
    }
    $('wallpaper').style.background = (bg.charAt(0) === '#' ? bg : bg + ' center / cover no-repeat, var(--abyss)');
  }

  function applyMode() {
    var m = HX.prefs.get('mode') || 'auto';
    var mob = m === 'mobile' || (m === 'auto' && Math.min(window.innerWidth, 99999) < 900);
    if (mob !== state.mobile) {
      state.mobile = mob;
      document.body.classList.toggle('mobile', mob);
      renderDesk();
      if (state.overview) exitOverview();
      tick();
    }
    WM.layoutAll();
  }
  shell.isMobile = function () { return state.mobile; };

  /* ================================================================== Leiste oben */
  function buildPanel() {
    var ov = $('p-overview');
    ov.appendChild(HX.mark());
    ov.appendChild(el('span', { text: 'Übersicht' }));
    ov.addEventListener('click', function () {
      if (state.mobile) { toggleLauncher(); return; }
      toggleOverview();
    });
    $('p-clock').addEventListener('click', function () { openCalendar($('p-clock')); });
    $('p-status').addEventListener('click', function () { openQuick($('p-status')); });
    renderStatus();
  }
  function renderActive(w) {
    var n = $('p-active');
    n.textContent = w ? w.title : '';
    n.hidden = !w;
  }
  var lastMin = -1;
  function tick() {
    var d = new Date(), sec = HX.prefs.get('seconds');
    $('p-clock').textContent = (state.mobile ? '' : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }) + '  ') + HX.fmt.time(d, sec);
    if (d.getMinutes() !== lastMin) {
      lastMin = d.getMinutes();
      var hc = document.querySelector('.home-clock'), hd = document.querySelector('.home-date');
      if (hc) hc.textContent = HX.fmt.time(d);
      if (hd) hd.textContent = HX.fmt.day(d);
    }
    clearTimeout(tick.t);
    tick.t = setTimeout(tick, sec ? 1000 - d.getMilliseconds() + 5 : (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 5);
  }
  function battery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      state.battery = b;
      ['levelchange', 'chargingchange'].forEach(function (ev) { b.addEventListener(ev, renderStatus); });
      renderStatus();
    }).catch(function () { });
  }
  function renderStatus() {
    var s = HX.clear($('p-status'));
    if (H && H.dev) s.appendChild(el('span.dot', { title: 'Entwicklungsmodus' }));
    s.appendChild(icon(navigator.onLine ? 'wifi' : 'wifi-off'));
    var b = state.battery;
    if (b) {
      s.appendChild(icon(b.charging ? 'battery-charging' : 'battery'));
      s.appendChild(el('span', { text: Math.round(b.level * 100) + ' %' }));
    }
    s.appendChild(icon('power'));
    s.setAttribute('aria-label', 'Schnelleinstellungen');
  }

  /* ================================================================== Dock */
  function buildDock() {
    var d = $('dock');
    d.appendChild(el('div.dock-list', { id: 'dock-list' }));
    d.appendChild(el('div.sep'));
    var grid = el('button.dock-item.grid-btn', { type: 'button', 'aria-label': 'Alle Apps', title: 'Alle Apps' },
      el('span.appicon', { style: { background: 'var(--raised)', boxShadow: 'none', color: 'var(--paper)' } }, icon('layout-grid', 'glyph')));
    grid.addEventListener('click', toggleLauncher);
    d.appendChild(grid);
    // Handy: Start, Fenster, Apps
    var mk = function (id, ic, label, fn) {
      var b = el('button.nav-btn', { type: 'button', id: id, 'aria-pressed': 'false' }, icon(ic), el('span', { text: label }));
      b.addEventListener('click', fn);
      d.appendChild(b);
      return b;
    };
    mk('nav-home', 'house', 'Start', goHome);
    mk('nav-windows', 'layers', 'Fenster', toggleOverview);
    mk('nav-apps', 'layout-grid', 'Apps', toggleLauncher);
  }
  function renderNavBadge() {
    var b = $('nav-windows');
    if (!b) return;
    var old = b.querySelector('.badge'); if (old) old.remove();
    if (WM.wins.length) b.appendChild(el('span.badge', { text: String(WM.wins.length) }));
    $('nav-home').setAttribute('aria-pressed', String(!state.launcher && !state.overview && !WM.visible().length));
    $('nav-windows').setAttribute('aria-pressed', String(state.overview));
    $('nav-apps').setAttribute('aria-pressed', String(state.launcher));
  }
  function renderDock() {
    var list = $('dock-list');
    if (!list) return;
    HX.clear(list);
    var ids = (HX.prefs.get('dock') || []).slice();
    WM.wins.forEach(function (w) { if (ids.indexOf(w.app.id) < 0) ids.push(w.app.id); });
    var f = WM.focused();
    ids.forEach(function (id) {
      var app = Apps.get(id);
      if (!app) return;
      var running = WM.ofApp(id).length > 0;
      var b = el('button.dock-item', { type: 'button', title: app.name, 'aria-label': app.name,
        class: (running ? 'running' : '') + (f && f.app.id === id ? ' focused' : '') }, el('span.run'), HX.appIcon(app, 40));
      b.addEventListener('click', function () { dockClick(app); });
      longPress(b, function (at) { appMenu(app, at); });
      list.appendChild(b);
    });
    renderNavBadge();
  }
  function dockClick(app) {
    var ws = WM.ofApp(app.id);
    if (!ws.length) { shell.openApp(app.id); return; }
    var f = WM.focused();
    if (f && f.app.id === app.id) {
      if (ws.length > 1) { var i = ws.indexOf(f); WM.focus(ws[(i + 1) % ws.length]); }
      else WM.minimize(f);
      return;
    }
    var top = ws.slice().sort(function (a, b) { return (+b.el.style.zIndex) - (+a.el.style.zIndex); })[0];
    WM.restore(top);
  }

  /** Langes Drücken (Touch) oder Rechtsklick → Menü. */
  function longPress(n, fn) {
    var t = null, fired = false, sx = 0, sy = 0;
    n.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!fired) fn({ x: e.clientX, y: e.clientY }); });
    n.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      fired = false; sx = e.clientX; sy = e.clientY;
      t = setTimeout(function () { fired = true; fn({ x: sx, y: sy }); if (navigator.vibrate) navigator.vibrate(12); }, 520);
    });
    var cancel = function (e) { if (e && e.type === 'pointermove' && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 10) return; clearTimeout(t); };
    n.addEventListener('pointermove', cancel);
    n.addEventListener('pointerup', function () { clearTimeout(t); });
    n.addEventListener('pointercancel', cancel);
    n.addEventListener('click', function (e) { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  }
  shell.longPress = longPress;

  function appMenu(app, at) {
    var dock = HX.prefs.get('dock') || [];
    var pinned = dock.indexOf(app.id) >= 0;
    var ws = WM.ofApp(app.id);
    var items = [{ head: app.name }];
    items.push({ label: ws.length ? 'Zum Fenster' : 'Öffnen', icon: 'app-window', run: function () { dockClick(app); } });
    if (!app.single) items.push({ label: 'Neues Fenster', icon: 'plus', run: function () { shell.openApp(app.id, null, { newWindow: true }); } });
    (app.shortcuts || []).slice(0, 6).forEach(function (s) {
      items.push({ label: s.name, icon: 'link', run: function () { WM.open(app, { url: s.url, newWindow: true }); } });
    });
    items.push('-');
    items.push({ label: pinned ? 'Vom Dock lösen' : 'Im Dock behalten', icon: pinned ? 'pin-off' : 'pin', run: function () {
      var d = (HX.prefs.get('dock') || []).filter(function (x) { return x !== app.id; });
      if (!pinned) d.push(app.id);
      HX.prefs.set('dock', d);
    } });
    if (!app.system) {
      items.push({ label: 'Auf den Startbildschirm', icon: 'smartphone', run: function () { shell.homeShortcut(app, app.url, app.name); } });
      items.push({ label: 'App-Infos', icon: 'info', run: function () { shell.openApp('sys:appcenter', { app: app.id }); } });
    }
    if (ws.length) {
      items.push('-');
      items.push({ label: ws.length > 1 ? 'Alle Fenster schließen' : 'Schließen', icon: 'x', danger: true, run: function () { ws.forEach(WM.close); } });
    }
    HX.menu(items, at);
  }

  /* ================================================================== Arbeitsfläche / Startseite */
  function renderDesk() {
    var d = HX.clear($('desk'));
    if (state.mobile) { d.appendChild(homeView()); return; }
    if (HX.prefs.get('desktopIcons') === false) return;
    var g = el('div.desk-icons');
    var files = Apps.get('sys:files');
    g.appendChild(deskIcon({ id: 'home', name: 'Persönlicher Ordner', glyph: 'house', colors: files.colors }, function () { shell.openApp('sys:files', { root: 'home' }); }));
    Apps.installed().forEach(function (a) { g.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
    (HX.prefs.get('pins') || []).forEach(function (p, i) { g.appendChild(pinIcon(p, i)); });
    d.appendChild(g);
  }
  function deskIcon(app, run, menu) {
    var b = el('button.desk-icon', { type: 'button' }, HX.appIcon(app, 48), el('span.label', { text: app.name }));
    b.addEventListener(state.mobile ? 'click' : 'dblclick', run);
    if (!state.mobile) b.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    if (menu) longPress(b, function (at) { appMenu(app, at); });
    return b;
  }
  function pinIcon(p, i) {
    var app = Apps.byOrigin(safeOrigin(p.url));
    var look = { id: p.url, name: p.title || 'Direktlink', iconUrl: app ? app.iconUrl : null, glyph: app ? null : 'link' };
    var run = function () { openUrl(p.url); };
    var b = deskIcon(look, run, false);
    longPress(b, function (at) {
      HX.menu([{ head: look.name },
        { label: 'Öffnen', icon: 'external-link', run: run },
        { label: 'Umbenennen', icon: 'pencil', run: function () {
          HX.prompt({ title: 'Direktlink umbenennen', value: p.title, ok: 'Umbenennen' }).then(function (v) {
            if (v == null || !v.trim()) return;
            var pins = (HX.prefs.get('pins') || []).slice(); pins[i] = Object.assign({}, pins[i], { title: v.trim() }); HX.prefs.set('pins', pins);
          });
        } },
        { label: 'Entfernen', icon: 'trash-2', danger: true, run: function () {
          var pins = (HX.prefs.get('pins') || []).slice(); pins.splice(i, 1); HX.prefs.set('pins', pins);
        } }], at);
    });
    return b;
  }
  function safeOrigin(u) { try { return new URL(u).origin; } catch (e) { return ''; } }

  function homeView() {
    var d = new Date();
    var v = el('div.home', null,
      el('div.home-clock', { text: HX.fmt.time(d) }),
      el('div.home-date', { text: HX.fmt.day(d) }));
    // Die drei Suiten des Ökosystems
    var su = el('div.suites');
    Apps.suites.forEach(function (s) {
      var app = Apps.suite(s.role);
      var card = el('div.suite', { class: app ? null : 'missing', role: app ? 'button' : null, tabindex: app ? '0' : null },
        HX.appIcon(app || s, 46),
        el('div.t', null, el('div.n', { text: app ? app.name : s.name }), el('div.s', { text: app ? (app.version ? 'Version ' + app.version : s.about) : 'Nicht installiert' })),
        app ? icon('chevron-right') : el('button.btn.ghost', { type: 'button', text: 'Installieren', onclick: function () { shell.openApp('sys:appcenter', { suite: s.role }); } }));
      if (app) {
        card.addEventListener('click', function (e) { if (!e.target.closest('.chip')) shell.openApp(app.id); });
        longPress(card, function (at) { appMenu(app, at); });
        if (app.shortcuts && app.shortcuts.length) {
          var chips = el('div.chips');
          app.shortcuts.slice(0, 5).forEach(function (sc) {
            chips.appendChild(el('button.chip', { type: 'button', text: sc.name, onclick: function () { WM.open(app, { url: sc.url, newWindow: true }); } }));
          });
          card.appendChild(chips);
        }
      }
      su.appendChild(card);
    });
    v.appendChild(el('h2', { text: 'Suiten' }));
    v.appendChild(su);
    var others = Apps.installed().filter(function (a) { return Apps.suites.every(function (s) { return s.role !== a.role; }); });
    var pins = HX.prefs.get('pins') || [];
    v.appendChild(el('h2', { text: 'Deine Apps' }));
    if (!others.length && !pins.length) {
      v.appendChild(el('div.suite', { role: 'button', tabindex: '0', onclick: function () { shell.openApp('sys:appcenter'); } },
        HX.appIcon(Apps.get('sys:appcenter'), 46),
        el('div.t', null, el('div.n', { text: 'App hinzufügen' }), el('div.s', { text: 'Paket installieren oder einen Ordner verbinden' })),
        icon('chevron-right')));
    } else {
      var g = el('div.home-grid');
      others.forEach(function (a) { g.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
      pins.forEach(function (p, i) { g.appendChild(pinIcon(p, i)); });
      v.appendChild(g);
    }
    v.appendChild(el('h2', { text: 'Helix' }));
    var sg = el('div.home-grid');
    Apps.system.forEach(function (a) { sg.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
    v.appendChild(sg);
    return v;
  }

  function goHome() {
    closeLauncher(); exitOverview();
    WM.minimizeAll();
    renderNavBadge();
  }

  /* ================================================================== Starter */
  function toggleLauncher() { if (state.launcher) closeLauncher(); else openLauncher(); }
  function openLauncher(q) {
    exitOverview();
    if (!state.launcher) {
      state.launcher = true;
      $('launcher').hidden = false;
      document.body.classList.add('dim');
      state.launcherLayer = HX.pushLayer(closeLauncher);
    }
    var inp = $('launch-q');
    inp.value = q || '';
    renderLauncher();
    if (!state.mobile || q) setTimeout(function () { inp.focus(); }, 30);
    renderNavBadge();
  }
  function closeLauncher() {
    if (!state.launcher) return;
    state.launcher = false;
    $('launcher').hidden = true;
    document.body.classList.remove('dim');
    if (state.launcherLayer) state.launcherLayer();
    renderNavBadge();
  }
  function renderLauncher() {
    var q = $('launch-q').value.trim().toLowerCase();
    var out = HX.clear($('launch-list'));
    var hits = Apps.search(q);
    var sys = hits.filter(function (a) { return a.system; }), mine = hits.filter(function (a) { return !a.system; });
    var pins = (HX.prefs.get('pins') || []).filter(function (p) { return !q || (p.title || '').toLowerCase().indexOf(q) >= 0; });
    var section = function (title, list, mk) {
      if (!list.length) return;
      out.appendChild(el('h2', { text: title }));
      var g = el('div.launch-grid');
      list.forEach(function (x, i) { g.appendChild(mk(x, i)); });
      out.appendChild(g);
    };
    var mkApp = function (a) {
      var b = el('button.desk-icon', { type: 'button' }, HX.appIcon(a, 58), el('span.label', { text: a.name }));
      b.addEventListener('click', function () { closeLauncher(); shell.openApp(a.id); });
      longPress(b, function (at) { appMenu(a, at); });
      return b;
    };
    section('Deine Apps', mine, mkApp);
    section('Direktlinks', pins, function (p) {
      var app = Apps.byOrigin(safeOrigin(p.url));
      var b = el('button.desk-icon', { type: 'button' }, HX.appIcon({ id: p.url, name: p.title, iconUrl: app && app.iconUrl, glyph: app ? null : 'link' }, 58), el('span.label', { text: p.title || 'Direktlink' }));
      b.addEventListener('click', function () { closeLauncher(); openUrl(p.url); });
      return b;
    });
    section('Helix', sys, mkApp);
    if (!out.children.length) {
      out.appendChild(el('div.launch-empty', null,
        el('p', { text: q ? 'Keine App heißt „' + q + '“.' : 'Noch keine Apps installiert.' }),
        el('button.btn', { type: 'button', onclick: function () { closeLauncher(); shell.openApp('sys:appcenter'); } }, icon('package-plus'), 'App-Center öffnen')));
    }
  }

  /* ================================================================== Übersicht */
  var ovLabels = [];
  function toggleOverview() { if (state.overview) exitOverview(); else enterOverview(); }
  function enterOverview() {
    closeLauncher();
    if (state.overview) return;
    state.overview = true;
    document.body.classList.add('overview', 'dim');
    $('overview').hidden = false;
    $('ov-q').value = '';
    state.ovLayer = HX.pushLayer(exitOverview);
    layoutOverview();
    if (!state.mobile) setTimeout(function () { $('ov-q').focus(); }, 50);
    renderNavBadge();
  }
  function exitOverview(keep) {
    if (!state.overview) return;
    state.overview = false;
    document.body.classList.remove('overview', 'dim');
    $('overview').hidden = true;
    ovLabels.forEach(function (n) { n.remove(); });
    ovLabels = [];
    WM.wins.forEach(function (w) {
      w.el.style.transform = '';
      w.el.style.transformOrigin = '';
      w.el.classList.toggle('minimized', !!w.min);
      w.el.removeEventListener('click', w.ovClick, true);
    });
    if (state.ovLayer) state.ovLayer();
    renderNavBadge();
  }
  function layoutOverview() {
    ovLabels.forEach(function (n) { n.remove(); });
    ovLabels = [];
    var ws = WM.wins.slice().sort(function (a, b) { return a.id.localeCompare(b.id, 'en', { numeric: true }); });
    $('ov-empty').hidden = ws.length > 0;
    if (!ws.length) return;
    var a = WM.area(), top = a.y + 76, H0 = a.h - 76 - 20, W0 = a.w - 24;
    var n = ws.length, best = null;
    for (var cols = 1; cols <= n; cols++) {
      var rows = Math.ceil(n / cols), cw = W0 / cols, ch = H0 / rows;
      var s = Math.min(cw / a.w, ch / a.h);
      if (!best || s > best.s) best = { cols: cols, rows: rows, cw: cw, ch: ch, s: s };
    }
    ws.forEach(function (w, i) {
      w.el.classList.remove('minimized');
      var r = { x: parseFloat(w.el.style.left), y: parseFloat(w.el.style.top), w: parseFloat(w.el.style.width), h: parseFloat(w.el.style.height) };
      var col = i % best.cols, row = Math.floor(i / best.cols);
      var inRow = Math.min(best.cols, n - row * best.cols);
      var offX = (W0 - inRow * best.cw) / 2;
      var cx = a.x + 12 + offX + col * best.cw + best.cw / 2, cy = top + row * best.ch + best.ch / 2 - 12;
      var s = Math.min((best.cw - 28) / r.w, (best.ch - 56) / r.h, 1);
      var tx = cx - r.w * s / 2 - r.x, ty = cy - r.h * s / 2 - r.y;
      w.el.style.transformOrigin = '0 0';
      w.el.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      if (!w.ovClick) w.ovClick = function (e) {
        if (!state.overview) return;
        e.stopPropagation(); e.preventDefault();
        exitOverview();
        WM.restore(w);
      };
      w.el.removeEventListener('click', w.ovClick, true);
      w.el.addEventListener('click', w.ovClick, true);
      var lab = el('div.ov-label', { style: { left: cx + 'px', top: (cy + r.h * s / 2 + 8) + 'px' } },
        HX.appIcon(w.app, 18), el('span', { text: w.title }),
        el('button.icon-btn', { type: 'button', 'aria-label': 'Schließen', onclick: function () { WM.close(w); } }, icon('x')));
      document.body.appendChild(lab);
      ovLabels.push(lab);
    });
  }

  /* ================================================================== Blätter: Kalender, Schnelleinstellungen */
  function openCalendar(at) {
    var box = el('div');
    var d = new Date(), y = d.getFullYear(), m = d.getMonth();
    var cal = el('div.cal', null, el('div.cal-head', null,
      el('b', { text: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) }),
      el('span', { style: { color: 'var(--mist)' }, text: d.toLocaleDateString('de-DE', { weekday: 'long' }) })));
    var t = el('table'), hr = el('tr');
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach(function (x) { hr.appendChild(el('th', { text: x })); });
    t.appendChild(hr);
    var first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    for (var r = 0; r < 6; r++) {
      var tr = el('tr');
      for (var c = 0; c < 7; c++) {
        var x = new Date(start); x.setDate(start.getDate() + r * 7 + c);
        tr.appendChild(el('td', { text: x.getDate(), class: x.toDateString() === d.toDateString() ? 'today' : x.getMonth() !== m ? 'other' : null }));
      }
      t.appendChild(tr);
      if (x.getMonth() !== m && r >= 4) break;
    }
    cal.appendChild(t);
    box.appendChild(cal);
    var notes = (HX.prefs.get('notes') || []).slice().reverse();
    var head = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' } },
      el('b', { style: { fontFamily: 'var(--font-display)', fontWeight: 500 }, text: 'Benachrichtigungen' }));
    if (notes.length) head.appendChild(el('button.btn.ghost', { type: 'button', text: 'Alle löschen', onclick: function () { HX.prefs.set('notes', []); pop.close(); } }));
    box.appendChild(head);
    var list = el('div.notes-list');
    if (!notes.length) list.appendChild(el('div.note', null, el('small', { text: 'Keine neuen Benachrichtigungen' })));
    notes.slice(0, 12).forEach(function (n) {
      var app = Apps.get(n.app);
      list.appendChild(el('div.note', null, el('b', { text: n.title }), n.body ? el('div', { text: n.body }) : null,
        el('small', { text: (app ? app.name + ', ' : '') + HX.fmt.ago(n.t) })));
    });
    box.appendChild(list);
    var pop = HX.popover(box, at, { className: 'qs' });
  }

  function openQuick(at) {
    var s = state.settings || {};
    var box = el('div');
    var tiles = el('div.qs-tiles');
    var tile = function (ic, title, sub, on, fn) {
      var b = el('button.tile', { type: 'button', 'aria-pressed': String(!!on) }, icon(ic), el('span.t', null, el('b', { text: title }), el('small', { text: sub })));
      b.addEventListener('click', function () { fn(b); });
      tiles.appendChild(b);
      return b;
    };
    var t = themeNow();
    tile(t === 'light' ? 'sun' : 'moon', 'Dunkel', t === 'light' ? 'Aus' : 'An', t !== 'light', function (b) {
      var nt = themeNow() === 'light' ? 'dark' : 'light';
      HX.prefs.set('theme', nt);
      b.setAttribute('aria-pressed', String(nt === 'dark'));
      b.querySelector('small').textContent = nt === 'dark' ? 'An' : 'Aus';
      HX.clear(b.firstChild).appendChild(icon(nt === 'light' ? 'sun' : 'moon').firstChild);
    });
    tile(state.mobile ? 'smartphone' : 'monitor', 'Ansicht', state.mobile ? 'Handy' : 'Desktop', false, function () {
      HX.prefs.set('mode', state.mobile ? 'desktop' : 'mobile');
      pop.close();
    });
    if (H) {
      tile('activity', 'Wach halten', s.keepAlive ? 'Läuft im Hintergrund' : 'Aus', s.keepAlive, function (b) {
        var on = !(state.settings && state.settings.keepAlive);
        HX.api('/api/system/settings', { method: 'PUT', json: { keepAlive: on } }).then(function (ns) {
          state.settings = ns;
          b.setAttribute('aria-pressed', String(!!ns.keepAlive));
          b.querySelector('small').textContent = ns.keepAlive ? 'Läuft im Hintergrund' : 'Aus';
        }).catch(function (e) { HX.toast(HX.errText(e)); });
      });
      tile('maximize-2', 'Vollbild', 'Systemleisten', !!document.fullscreenElement, function () {
        pop.close();
        if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () { });
      });
    }
    box.appendChild(tiles);
    if (state.battery) {
      var b = state.battery;
      box.appendChild(el('div.menu-head', { style: { padding: '12px 2px 0' }, text: 'Akku ' + Math.round(b.level * 100) + ' %' + (b.charging ? ', lädt' : '') }));
    }
    var row = el('div.qs-row');
    row.appendChild(el('button.btn', { type: 'button', onclick: function () { pop.close(); shell.openApp('sys:settings'); } }, icon('settings'), 'Einstellungen'));
    row.appendChild(el('button.icon-btn', { type: 'button', title: 'Desktop neu laden', 'aria-label': 'Desktop neu laden', onclick: function () { pop.close(); reloadDesktop(); } }, icon('refresh-cw')));
    if (H) row.appendChild(el('button.icon-btn', { type: 'button', title: 'Helix beenden', 'aria-label': 'Helix beenden', onclick: function () {
      pop.close();
      HX.confirm({ title: 'Helix beenden?', text: 'Alle Fenster werden geschlossen. Beim nächsten Start stellt Helix sie wieder her.', ok: 'Beenden', danger: true }).then(function (ok) {
        if (!ok) return;
        saveSession(); HX.prefs.save(true);
        setTimeout(function () { HX.api('/api/system/exit', { method: 'POST' }).catch(function () { }); }, 300);
      });
    } }, icon('power')));
    box.appendChild(row);
    var pop = HX.popover(box, at, { className: 'qs' });
  }
  function reloadDesktop() {
    saveSession(); HX.prefs.save(true);
    setTimeout(function () { location.reload(); }, 250);
  }
  shell.reload = reloadDesktop;

  /* ================================================================== Öffnen */
  shell.openApp = function (id, params, opts) {
    var app = Apps.resolve(id);
    if (!app) {
      // Vielleicht gerade erst installiert: Liste neu holen und noch einmal versuchen.
      if (HX.online && !(opts && opts.retried)) {
        Apps.refresh().then(function () { shell.openApp(id, params, Object.assign({}, opts || {}, { retried: true })); });
        return null;
      }
      HX.toast('„' + id + '“ ist nicht installiert.');
      return null;
    }
    closeLauncher(); exitOverview();
    return WM.open(app, Object.assign({ path: params || null }, opts || {}));
  };
  shell.openFile = function (root, path, appId) {
    var name = path.split('/').pop();
    var id = appId || Apps.handlerFor(name);
    if (!id) {
      HX.confirm({ title: name, text: 'Für diesen Dateityp gibt es keine passende App. Als Text öffnen?', ok: 'Im Editor öffnen' }).then(function (ok) {
        if (ok) shell.openApp('sys:editor', { root: root, path: path }, { newWindow: true });
      });
      return;
    }
    if (id === 'sys:appcenter') { shell.openApp(id, { root: root, path: path }); return; }
    shell.openApp(id, { root: root, path: path }, { newWindow: true });
  };
  function openUrl(url) {
    var u;
    try { u = new URL(url, location.href); } catch (e) { HX.toast('Ungültige Adresse'); return; }
    if (u.origin === location.origin) {
      var m = /\/apps\/([a-z]+)\//.exec(u.pathname);
      var sys = m && Apps.get('sys:' + m[1]);
      if (sys) { WM.open(sys, { url: u.href }); return; }
    }
    var app = Apps.byOrigin(u.origin);
    if (app) {
      var ex = WM.ofApp(app.id)[0];
      if (ex && !app.single) { WM.open(app, { url: u.href, newWindow: true }); return; }
      if (ex) { WM.post(ex, 'navigate', { url: u.href }); WM.restore(ex); return; }
      WM.open(app, { url: u.href });
      return;
    }
    if (H && /^https?:\/\/[^/]+\.(helix\.local|localhost)(:\d+)?\//i.test(u.href)) { HX.toast('Diese App ist nicht installiert.'); return; }
    if (H) HX.api('/api/system/open-url', { method: 'POST', json: { url: u.href } }).catch(function (e) { HX.toast(HX.errText(e)); });
    else window.open(u.href, '_blank', 'noopener');
  }
  shell.openUrl = openUrl;
  shell.pin = function (app, url, title) {
    var pins = (HX.prefs.get('pins') || []).slice();
    if (pins.some(function (p) { return p.url === url; })) { HX.toast('Diesen Direktlink gibt es schon.'); return; }
    pins.push({ url: url, title: title || app.name, app: app.id });
    HX.prefs.set('pins', pins);
    HX.notify({ title: 'Direktlink gemerkt', body: title || app.name, app: app, log: false });
  };
  shell.homeShortcut = function (app, url, title) {
    if (!H) return;
    var path = '';
    try { var u = new URL(url); if (u.origin === app.origin) path = u.pathname.replace(/^\//, '') + u.search + u.hash; } catch (e) { }
    HX.api('/api/system/pin-shortcut', { method: 'POST', json: { app: app.id, name: title || app.name, path: path } })
      .then(function () { HX.toast('Android fragt gleich nach, ob das Symbol auf den Startbildschirm soll.'); })
      .catch(function (e) { HX.toast(HX.errText(e)); });
  };
  /** Paket (Datei) bereitlegen und im App-Center zeigen. */
  shell.installPackage = function (blob, name) {
    return HX.api('/api/packages?name=' + encodeURIComponent(name || blob.name || 'paket'), { method: 'POST', body: blob })
      .then(function (info) { shell.openApp('sys:appcenter', { package: info.id }); return info; });
  };

  /* ================================================================== Sitzung */
  function saveSession() {
    if (HX.prefs.get('restore') === false) { if ((HX.prefs.get('session') || []).length) HX.prefs.set('session', []); return; }
    HX.prefs.set('session', WM.session());
  }
  function restoreSession() {
    if (HX.prefs.get('restore') === false) return;
    var list = HX.prefs.get('session') || [];
    var top = null;
    list.slice(0, 12).forEach(function (s) {
      var app = Apps.get(s.app);
      if (!app) return;
      var w = WM.open(app, { url: s.url, rect: s.rect, max: s.max, min: s.min, newWindow: true, focus: !s.min });
      if (!s.min) top = w;
    });
    if (top) WM.focus(top);
  }
  function handleStartParams() {
    var p = new URLSearchParams(location.search);
    if (p.get('open')) shell.openApp(p.get('open'), p.get('path') || null);
  }

  /* ================================================================== Android → Desktop */
  function hello() {
    if (!H) return;
    var poll = function () {
      HX.api('/api/desktop/hello', { method: 'POST' }).then(function (r) {
        (r && r.events || []).forEach(function (e) { nativeEvent(e.type, e.data || {}); });
      }).catch(function () { });
    };
    poll();
    if (H.dev) setInterval(poll, 1500);
  }
  function nativeEvent(type, data) {
    switch (type) {
      case 'apps': Apps.refresh(); break;
      case 'package': shell.openApp('sys:appcenter', { package: data.id, from: data.from || '' }); break;
      case 'open': if (data.app) shell.openApp(data.app, data.path || null); break;
      case 'open-url': if (data.url) openUrl(data.url); break;
      case 'resume': tick(); Apps.refresh(); break;
      case 'pause': saveSession(); HX.prefs.save(true); break;
      case 'storage': break;
    }
    HX.emit('native:' + type, data);
  }
  window.__helixDesktop = {
    emit: function (type, data) { try { nativeEvent(type, data || {}); } catch (e) { console.error(e); } },
    /** Android-Zurück. true = erledigt, false = Helix in den Hintergrund. */
    back: function () {
      if (HX.closeTopLayer()) return true;
      var w = WM.focused();
      if (!w) w = null;
      if (w && !w.min) {
        WM.back(w).then(function (done) {
          if (done) return;
          if (state.mobile) WM.minimize(w); else WM.close(w);
        });
        return true;
      }
      return false;
    },
    insets: function (i) {
      var r = document.documentElement.style;
      r.setProperty('--sat', (i.top || 0) + 'px');
      r.setProperty('--sab', (i.bottom || 0) + 'px');
      r.setProperty('--sal', (i.left || 0) + 'px');
      r.setProperty('--sar', (i.right || 0) + 'px');
      WM.layoutAll();
      if (state.overview) layoutOverview();
    },
    openUrl: openUrl
  };

  /* ================================================================== Apps → Desktop */
  function onMessage(ev) {
    var m = ev.data;
    if (!m || m.__helix !== 1) return;
    var w = WM.byWindow(ev.source);
    if (!w || w.app.system || ev.origin !== w.app.origin) return;
    if (!m.op) { WM.reply(m); return; }
    var a = m.args || {};
    var reply = function (v) { if (m.rid) try { ev.source.postMessage({ __helix: 1, rid: m.rid, value: v }, ev.origin); } catch (e) { } };
    switch (m.op) {
      case 'state': WM.setState(w, a); break;
      case 'title': WM.setTitle(w, a.title); break;
      case 'close': WM.close(w); break;
      case 'notify':
        HX.notify({ title: String(a.title || w.app.name).slice(0, 120), body: String(a.body || '').slice(0, 600), app: w.app,
          run: function () { WM.restore(w); } });
        break;
      case 'open': {
        var target = Apps.resolve(a.app);
        if (!target) { HX.toast('„' + a.app + '“ ist nicht installiert.'); reply(false); break; }
        WM.open(target, { path: a.path || null, newWindow: !!a.path && !target.single });
        reply(true);
        break;
      }
      case 'open-url': if (a.url) openUrl(String(a.url)); break;
      case 'pin': shell.pin(w.app, String(a.url || w.url), String(a.title || w.title)); break;
      case 'update': shell.openApp('sys:appcenter', { app: w.app.id, check: 1 }); break;
    }
  }

  /* ================================================================== Tastatur */
  function onKey(e) {
    if (e.key === 'Escape') {
      if (HX.closeTopLayer()) { e.preventDefault(); return; }
    }
    if (e.key === 'Meta' || (e.ctrlKey && e.code === 'Space')) { e.preventDefault(); toggleOverview(); return; }
    if (e.altKey && e.key === 'F4' && WM.focused()) { e.preventDefault(); WM.close(WM.focused()); }
  }

  /* Suche in Übersicht und Starter */
  function wireSearch() {
    $('launch-q').addEventListener('input', renderLauncher);
    $('launch-q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var f = $('launch-list').querySelector('.desk-icon'); if (f) f.click(); }
    });
    $('ov-q').addEventListener('input', function () {
      var q = $('ov-q').value;
      if (q) { exitOverview(); openLauncher(q); }
    });
    $('overview').addEventListener('click', function (e) { if (e.target === $('overview') || e.target.id === 'ov-empty') exitOverview(); });
    $('launcher').addEventListener('click', function (e) { if (e.target === $('launcher') || e.target.classList.contains('launch-inner')) closeLauncher(); });
    $('desk').addEventListener('contextmenu', function (e) {
      if (e.target.closest('.desk-icon') || state.mobile) return;
      e.preventDefault();
      HX.menu([
        { label: 'Hintergrund ändern', icon: 'image', run: function () { shell.openApp('sys:settings', { page: 'look' }); } },
        { label: 'Dateien', icon: 'folder', run: function () { shell.openApp('sys:files'); } },
        { label: 'Desktop neu laden', icon: 'refresh-cw', run: reloadDesktop }
      ], { x: e.clientX, y: e.clientY });
    });
  }

  document.addEventListener('DOMContentLoaded', function () { wireSearch(); boot(); });
})();
