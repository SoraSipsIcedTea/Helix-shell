/* Helix-Desktop: Fensterverwaltung – Fenster öffnen, ziehen, Größe ändern, einrasten, fokussieren. */
(function () {
  'use strict';
  var HX = window.HX, el = HX.el, icon = HX.icon;

  var ALLOW = 'fullscreen; clipboard-read; clipboard-write; geolocation; camera; microphone; autoplay; ' +
    'screen-wake-lock; display-capture; encrypted-media; picture-in-picture';
  var wins = [];
  var zTop = 10, seq = 0, focusedWin = null, lastArea = null;
  var host;

  var WM = HX.wm = {
    wins: wins,
    init: function () {
      host = document.getElementById('windows');
      // Klick in ein fremdes iframe: der Desktop verliert den Fokus, das iframe hat ihn.
      window.addEventListener('blur', function () {
        setTimeout(function () {
          var a = document.activeElement;
          if (a && a.tagName === 'IFRAME') { var w = WM.byFrameEl(a); if (w && w !== focusedWin) WM.focus(w, true); }
        }, 0);
      });
      window.addEventListener('resize', function () { WM.layoutAll(); });
    },
    focused: function () { return focusedWin; },
    visible: function () { return wins.filter(function (w) { return !w.min; }); },
    byFrameEl: function (f) { for (var i = 0; i < wins.length; i++) if (wins[i].frame === f) return wins[i]; return null; },
    byWindow: function (cw) { for (var i = 0; i < wins.length; i++) { try { if (wins[i].frame.contentWindow === cw) return wins[i]; } catch (e) { } } return null; },
    ofApp: function (appId) { return wins.filter(function (w) { return w.app.id === appId; }); },
    area: area,
    open: open,
    focus: focus,
    close: close,
    minimize: minimize,
    restore: restore,
    toggleMax: toggleMax,
    setTitle: setTitle,
    setState: setState,
    reload: reload,
    menu: winMenu,
    layoutAll: function () {
      // Ändert sich die Fläche (Drehen, Skalierung, Dock), kommen freie Fenster ganz in den sichtbaren Bereich.
      var a = area(), key = [a.x, a.y, a.w, a.h].map(Math.round).join(',');
      var fit = lastArea && key !== lastArea && !mobile();
      lastArea = key;
      wins.forEach(function (w) {
        if (fit && !w.max && !w.snap) {
          var r = w.rect;
          r.w = Math.max(260, Math.min(r.w, a.w)); r.h = Math.max(160, Math.min(r.h, a.h));
          r.x = Math.max(a.x, Math.min(r.x, a.x + a.w - r.w)); r.y = Math.max(a.y, Math.min(r.y, a.y + a.h - r.h));
        }
        apply(w);
      });
    },
    minimizeAll: function () { wins.forEach(function (w) { if (!w.min) minimize(w, true); }); focusedWin = null; changed(); },
    session: function () {
      return wins.map(function (w) {
        return { app: w.app.id, url: w.app.system ? w.startUrl : (w.url || w.startUrl), rect: w.rect, max: w.max, min: w.min };
      });
    },
    post: post,
    back: back
  };

  /* ------------------------------------------------------------------ Geometrie */
  function mobile() { return document.body.classList.contains('mobile'); }
  function px(name) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0; }
  /** Platz für Fenster. --top, --res-l/-r/-b setzt der Desktop (shell.js, layoutChrome):
   *  Leiste oben, Systemleisten und – je nach Einstellung – das Dock. */
  function area() {
    var W = window.innerWidth, Ht = window.innerHeight;
    var top = px('--top'), bottom = Ht - px('--sab') - px('--res-b');
    var left = px('--sal') + px('--res-l'), right = W - px('--sar') - px('--res-r');
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  function defaultRect(app) {
    var a = area(), s = app.size || [1000, 680];
    var w = Math.min(s[0], a.w - 40), h = Math.min(s[1], a.h - 40);
    var n = wins.filter(function (x) { return !x.min && !x.max; }).length % 6;
    var x = a.x + Math.max(10, (a.w - w) / 2) + (n - 2) * 28, y = a.y + Math.max(10, (a.h - h) / 2.4) + (n - 2) * 24;
    return clampRect({ x: x, y: y, w: w, h: h });
  }
  function clampRect(r) {
    var a = area();
    r.w = Math.max(260, Math.min(r.w, a.w));
    r.h = Math.max(160, Math.min(r.h, a.h));
    r.x = Math.min(Math.max(r.x, a.x - r.w + 120), a.x + a.w - 120);
    r.y = Math.min(Math.max(r.y, a.y), a.y + a.h - 40);
    return r;
  }
  function apply(w) {
    var s = w.el.style;
    if (w.max || mobile()) {
      var a = area(), snap = w.snap;
      if (snap && !mobile() && !w.max) a = snapRect(snap);
      s.left = a.x + 'px'; s.top = a.y + 'px'; s.width = a.w + 'px'; s.height = a.h + 'px';
    } else if (w.snap) {
      var r = snapRect(w.snap);
      s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
    } else {
      s.left = w.rect.x + 'px'; s.top = w.rect.y + 'px'; s.width = w.rect.w + 'px'; s.height = w.rect.h + 'px';
    }
    w.el.classList.toggle('max', !!(w.max || mobile()));
    w.el.classList.toggle('minimized', !!w.min);
    if (w.maxBtn) HX.clear(w.maxBtn).appendChild(icon(w.max ? 'minimize-2' : 'maximize-2'));
  }
  function snapRect(side) {
    var a = area();
    if (side === 'left') return { x: a.x, y: a.y, w: Math.round(a.w / 2), h: a.h };
    if (side === 'right') return { x: a.x + Math.round(a.w / 2), y: a.y, w: a.w - Math.round(a.w / 2), h: a.h };
    return a;
  }

  /* ------------------------------------------------------------------ Öffnen */
  /**
   * open(app, {url, path, rect, max, min, newWindow, focus})
   * app: Eintrag aus HX.apps. path: Unterseite der App bzw. Parameter einer System-App.
   */
  function open(app, o) {
    o = o || {};
    // Gibt es die App schon im Fenster, wird sie dort geöffnet (neues Fenster nur auf Wunsch).
    if (!o.newWindow) {
      var ex = WM.ofApp(app.id)[0];
      if (ex) {
        if (o.url || o.path) {
          var to = o.url || HX.apps.urlFor(app, o.path);
          if (app.system) navigateSystem(ex, to);
          else post(ex, 'navigate', { url: to }, 100);
        }
        if (o.focus !== false) restore(ex);
        return ex;
      }
    }
    var url = o.url || HX.apps.urlFor(app, o.path);
    var w = {
      id: 'w' + (++seq), app: app, url: url, startUrl: url, title: app.name, max: !!o.max, min: false, snap: null,
      rect: o.rect ? clampRect(Object.assign({}, o.rect)) : defaultRect(app)
    };
    build(w);
    wins.push(w);
    host.appendChild(w.el);
    apply(w);
    if (o.min) { w.min = true; apply(w); }
    else {
      w.el.style.opacity = '0'; w.el.style.transform = 'scale(.97)';
      requestAnimationFrame(function () {
        w.el.classList.add('anim');
        w.el.style.opacity = ''; w.el.style.transform = '';
        setTimeout(function () { w.el.classList.remove('anim'); }, 260);
      });
      if (o.focus !== false) focus(w);
    }
    changed();
    return w;
  }

  function build(w) {
    var app = w.app;
    w.titleEl = el('div.win-title', { text: w.title });
    w.maxBtn = el('button.icon-btn.b-max', { type: 'button', 'aria-label': 'Maximieren', onclick: function () { toggleMax(w); } });
    var menuBtn = el('button.icon-btn', { type: 'button', 'aria-label': 'Fenstermenü' }, icon('ellipsis-vertical'));
    menuBtn.addEventListener('click', function () { winMenu(w, menuBtn); });
    w.bar = el('div.win-bar', null,
      HX.appIcon(app, 22), w.titleEl, menuBtn,
      el('button.icon-btn', { type: 'button', 'aria-label': 'Minimieren', onclick: function () { minimize(w); } }, icon('minus')),
      w.maxBtn,
      el('button.icon-btn.close', { type: 'button', 'aria-label': 'Schließen', onclick: function () { close(w); } }, icon('x')));
    w.frame = el('iframe', {
      src: w.url, title: app.name, allow: ALLOW,
      referrerpolicy: 'strict-origin-when-cross-origin'
    });
    w.loading = el('div.win-loading');
    w.frame.addEventListener('load', function () {
      w.loading.hidden = true;
      if (app.system) hookSystem(w);
    });
    var body = el('div.win-body', null, w.frame, el('div.win-shield'), w.loading);
    w.el = el('section.win', { 'aria-label': app.name, class: app.system ? 'system' : null }, w.bar, body);
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (d) {
      var h = el('div.rz.' + d);
      h.addEventListener('pointerdown', function (e) { startResize(w, d, e); });
      w.el.appendChild(h);
    });
    w.el.addEventListener('pointerdown', function () { if (focusedWin !== w) focus(w); }, true);
    w.bar.addEventListener('pointerdown', function (e) { startDrag(w, e); });
    w.bar.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) toggleMax(w); });
    w.bar.addEventListener('contextmenu', function (e) { e.preventDefault(); winMenu(w, { x: e.clientX, y: e.clientY }); });
  }

  /** System-Apps teilen den Origin: Fokus und Titel direkt aus dem Dokument. */
  function hookSystem(w) {
    try {
      var d = w.frame.contentDocument;
      d.addEventListener('pointerdown', function () { if (focusedWin !== w) focus(w, true); }, true);
      if (d.title && d.title !== w.app.name) setTitle(w, d.title);
      w.frame.contentWindow.__hxWin = w;
      HX.emit('theme-apply', w.frame.contentWindow);
    } catch (e) { }
  }
  function navigateSystem(w, url) {
    w.startUrl = url;
    try {
      var cw = w.frame.contentWindow;
      if (cw && typeof cw.hxNavigate === 'function') { cw.hxNavigate(new URL(url)); return; }
    } catch (e) { }
    w.loading.hidden = false;
    w.frame.src = url;
  }

  /* ------------------------------------------------------------------ Zustand */
  function focus(w, fromFrame) {
    if (w.min) { w.min = false; apply(w); }
    w.el.style.zIndex = ++zTop;
    if (focusedWin && focusedWin !== w) focusedWin.el.classList.remove('focused');
    focusedWin = w;
    w.el.classList.add('focused');
    if (!fromFrame) { try { w.frame.focus({ preventScroll: true }); } catch (e) { } }
    HX.emit('focus', w);
  }
  function topVisible() {
    var best = null;
    wins.forEach(function (x) { if (!x.min && (!best || +x.el.style.zIndex > +best.el.style.zIndex)) best = x; });
    return best;
  }
  function blurTo() {
    var n = topVisible();
    if (n) focus(n);
    else { focusedWin = null; HX.emit('focus', null); }
  }
  function close(w, force) {
    var i = wins.indexOf(w);
    if (i < 0) return;
    if (!force && w.app.system) {
      var dirty = false;
      try { dirty = !!(w.frame.contentWindow.hxDirty && w.frame.contentWindow.hxDirty()); } catch (e) { }
      if (dirty) {
        focus(w);
        HX.confirm({ title: 'Änderungen verwerfen?', text: '„' + w.title + '“ hat ungespeicherte Änderungen.', ok: 'Verwerfen', danger: true })
          .then(function (ok) { if (ok) close(w, true); });
        return;
      }
    }
    wins.splice(i, 1);
    w.el.classList.add('anim');
    w.el.style.opacity = '0'; w.el.style.transform = 'scale(.97)';
    setTimeout(function () { w.frame.src = 'about:blank'; w.el.remove(); }, 180);
    if (focusedWin === w) { focusedWin = null; blurTo(); }
    changed();
  }
  function minimize(w, quiet) {
    w.min = true;
    w.el.classList.remove('focused');
    apply(w);
    if (!quiet) { if (focusedWin === w) { focusedWin = null; blurTo(); } changed(); }
  }
  function restore(w) { w.min = false; apply(w); focus(w); changed(); }
  function toggleMax(w) {
    w.snap = null;
    w.max = !w.max;
    w.el.classList.add('anim');
    apply(w);
    setTimeout(function () { w.el.classList.remove('anim'); }, 220);
    changed();
  }
  function setTitle(w, t) {
    t = String(t || '').trim() || w.app.name;
    w.title = t;
    w.titleEl.textContent = t;
    HX.emit('title', w);
  }
  function setState(w, s) {
    if (s.title != null) setTitle(w, s.title);
    if (s.url) { w.url = s.url; changed(); }
    var c = s.themeColor;
    if (c && /^#[0-9a-f]{3,8}$|^rgb/i.test(c)) {
      w.bar.style.setProperty('--bar', c);
      w.bar.style.setProperty('--bar-ink', ink(c));
    } else if (s.themeColor === '') { w.bar.style.removeProperty('--bar'); w.bar.style.removeProperty('--bar-ink'); }
  }
  function ink(c) {
    var d = document.createElement('div'); d.style.color = c; document.body.appendChild(d);
    var m = getComputedStyle(d).color.match(/\d+(\.\d+)?/g) || [0, 0, 0]; d.remove();
    var l = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    return l > 0.6 ? '#121A33' : '#F4F7FB';
  }
  function reload(w) {
    w.loading.hidden = false;
    if (w.app.system) { try { w.frame.contentWindow.location.reload(); return; } catch (e) { } }
    var u = w.url || w.startUrl;
    w.frame.src = 'about:blank';
    setTimeout(function () { w.frame.src = u; }, 30);
  }
  var changeTimer = null;
  function changed() {
    HX.emit('windows', wins);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function () { HX.emit('session'); }, 300);
  }

  /* ------------------------------------------------------------------ Nachrichten an Apps */
  var rid = 0, waiting = {};
  function post(w, op, args, timeout) {
    if (w.app.system) return Promise.resolve(null);
    return new Promise(function (res) {
      var id = 'd' + (++rid);
      waiting[id] = res;
      try { w.frame.contentWindow.postMessage({ __helix: 1, op: op, args: args || {}, rid: id }, w.app.origin); }
      catch (e) { delete waiting[id]; res(null); return; }
      setTimeout(function () { if (waiting[id]) { delete waiting[id]; res(null); } }, timeout || 1500);
    });
  }
  WM.reply = function (m) { var r = waiting[m.rid]; if (r) { delete waiting[m.rid]; r(m.value); return true; } return false; };

  /** „Zurück“ im Fenster. Ergebnis: true, wenn die App selbst zurückgegangen ist. */
  function back(w) {
    if (w.app.system) {
      try { var cw = w.frame.contentWindow; if (cw.hxBack && cw.hxBack()) return Promise.resolve(true); } catch (e) { }
      return Promise.resolve(false);
    }
    return post(w, 'back', {}, 700).then(function (v) { return v === true; });
  }

  /* ------------------------------------------------------------------ Ziehen und Größe ändern */
  var hint = null;
  function showHint(r) {
    if (!r) { if (hint) { hint.remove(); hint = null; } return; }
    if (!hint) { hint = el('div.snap-hint'); document.body.appendChild(hint); }
    Object.assign(hint.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
  function startDrag(w, e) {
    if (e.button !== 0 || e.target.closest('button') || mobile() || document.body.classList.contains('overview')) return;
    var sx = e.clientX, sy = e.clientY, moved = false, snapTo = null;
    var start = null;
    var bar = w.bar;
    bar.setPointerCapture(e.pointerId);
    var move = function (ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        document.body.classList.add('dragging');
        if (w.max || w.snap) {
          // Aus dem maximierten Zustand lösen: Fenster unter dem Zeiger zentrieren.
          var cur = w.el.getBoundingClientRect(), frac = (sx - cur.left) / cur.width;
          w.max = false; w.snap = null;
          w.rect.x = sx - w.rect.w * frac; w.rect.y = cur.top;
          apply(w);
        }
        start = { x: w.rect.x, y: w.rect.y };
      }
      w.rect.x = start.x + dx; w.rect.y = Math.max(area().y, start.y + dy);
      w.el.style.left = w.rect.x + 'px'; w.el.style.top = w.rect.y + 'px';
      var a = area();
      snapTo = ev.clientY <= a.y + 2 ? 'max' : ev.clientX <= a.x + 4 ? 'left' : ev.clientX >= a.x + a.w - 4 ? 'right' : null;
      showHint(snapTo ? (snapTo === 'max' ? a : snapRect(snapTo)) : null);
    };
    var up = function () {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      showHint(null);
      if (!moved) return;
      if (snapTo === 'max') { w.max = true; }
      else if (snapTo) { w.snap = snapTo; }
      clampRect(w.rect);
      w.el.classList.add('anim');
      apply(w);
      setTimeout(function () { w.el.classList.remove('anim'); }, 220);
      changed();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }
  function startResize(w, d, e) {
    if (e.button !== 0 || w.max || mobile()) return;
    e.preventDefault(); e.stopPropagation();
    if (w.snap) { var r0 = snapRect(w.snap); w.rect = { x: r0.x, y: r0.y, w: r0.w, h: r0.h }; w.snap = null; }
    var h = e.target, sx = e.clientX, sy = e.clientY, r = Object.assign({}, w.rect);
    h.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    var move = function (ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy, n = Object.assign({}, r);
      if (d.indexOf('e') >= 0) n.w = Math.max(260, r.w + dx);
      if (d.indexOf('s') >= 0) n.h = Math.max(160, r.h + dy);
      if (d.indexOf('w') >= 0) { n.w = Math.max(260, r.w - dx); n.x = r.x + r.w - n.w; }
      if (d.indexOf('n') >= 0) { n.h = Math.max(160, r.h - dy); n.y = Math.max(area().y, r.y + r.h - n.h); n.h = r.y + r.h - n.y; }
      w.rect = n;
      apply(w);
    };
    var up = function () {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      changed();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }

  /* ------------------------------------------------------------------ Fenstermenü */
  function winMenu(w, at) {
    var app = w.app, items = [];
    items.push({ label: 'Neu laden', icon: 'refresh-cw', run: function () { reload(w); } });
    if (!app.system) {
      items.push({ label: 'DevTools', icon: 'bug', run: function () { post(w, 'devtools', { show: true }); } });
      items.push({ label: 'Direktlink merken', icon: 'star', run: function () { HX.shell.pin(app, w.url || w.startUrl, w.title); } });
      items.push({ label: 'Auf den Startbildschirm', icon: 'smartphone', run: function () { HX.shell.homeShortcut(app, w.url || w.startUrl, w.title); } });
      items.push({ label: 'App-Infos', icon: 'info', run: function () { HX.shell.openApp('sys:appcenter', { app: (app.pkg || app).id }); } });
    } else {
      items.push({ label: 'DevTools', icon: 'bug', run: function () { erudaSystem(w); } });
    }
    if (!app.single) items.push({ label: 'Neues Fenster', icon: 'app-window', run: function () { open(app, { newWindow: true }); } });
    if (!mobile()) {
      items.push('-');
      items.push({ label: 'Links einrasten', icon: 'panel-left', run: function () { w.max = false; w.snap = 'left'; apply(w); changed(); } });
      items.push({ label: 'Rechts einrasten', icon: 'panel-left', run: function () { w.max = false; w.snap = 'right'; apply(w); changed(); } });
    }
    items.push('-');
    items.push({ label: 'Schließen', icon: 'x', danger: true, run: function () { close(w); } });
    HX.menu(items, at);
  }
  function erudaSystem(w) {
    try {
      var cw = w.frame.contentWindow, d = w.frame.contentDocument;
      var go = function () { try { if (!cw.__helixEruda) { cw.eruda.init(); cw.__helixEruda = true; } cw.eruda.show(); } catch (e) { } };
      if (cw.eruda) { go(); return; }
      var s = d.createElement('script');
      s.src = '/__helix/eruda.js';
      s.onload = go;
      s.onerror = function () { HX.toast('DevTools konnten nicht geladen werden.'); };
      d.head.appendChild(s);
    } catch (e) { }
  }
})();
