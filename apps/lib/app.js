/* Gemeinsame Helfer der Helix-System-Apps. Die Apps laufen im Desktop-Origin;
 * window.Helix (System-Rechte) kommt vom Server, parent.HX ist der Desktop. */
(function () {
  'use strict';
  var HX = null;
  try { HX = parent !== window && parent.HX ? parent.HX : null; } catch (e) { HX = null; }
  var A = window.A = { HX: HX, Helix: window.Helix || null };

  // Erscheinungsbild vom Desktop übernehmen (bevor etwas gezeichnet wird)
  try {
    document.documentElement.setAttribute('data-theme', HX ? HX.theme() : 'dark');
    var v = HX && HX.variant ? HX.variant() : '';
    if (v) document.documentElement.setAttribute('data-variant', v);
  } catch (e) { }

  A.params = new URLSearchParams(location.search);

  /* DOM – eigene Helfer, weil Knoten aus dem Desktop-Dokument hier nicht als Node zählen */
  A.el = function el(tag, attrs) {
    var cls = null, m = /^([a-z0-9-]+)((?:\.[\w-]+)*)$/i.exec(tag);
    if (m) { tag = m[1]; cls = m[2] ? m[2].slice(1).replace(/\./g, ' ') : null; }
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'class') n.className = (n.className ? n.className + ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  };
  function add(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(n, x); }); return; }
    n.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
  }
  var ICONS = (HX && parent.HXI) || window.HXI || {};
  A.icon = function (name, cls) {
    var s = document.createElement('span');
    s.className = 'ic' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.square || '') + '</svg>';
    return s;
  };
  A.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  A.$ = function (s, r) { return (r || document).querySelector(s); };
  A.appIcon = function (app, size) {
    var n = A.el('span.appicon');
    if (size) { n.style.width = size + 'px'; n.style.height = size + 'px'; }
    if (app && (app.iconUrl || app.icon) && /^https?:|^\//.test(app.iconUrl || app.icon)) {
      n.classList.add('img');
      var img = A.el('img', { src: app.iconUrl || app.icon, alt: '' });
      img.onerror = function () { n.classList.remove('img'); A.clear(n).appendChild(A.el('span', { text: (app.name || '?').charAt(0).toUpperCase() })); };
      n.appendChild(img);
    } else if (app && app.glyph) n.appendChild(A.icon(app.glyph));
    else n.appendChild(A.el('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 500 }, text: ((app && app.name) || '?').charAt(0).toUpperCase() }));
    if (app && app.colors) { n.style.setProperty('--a', app.colors[0]); n.style.setProperty('--b', app.colors[1]); }
    return n;
  };
  A.toggle = function (checked, onchange, label) {
    var inp = A.el('input', { type: 'checkbox', checked: checked, 'aria-label': label || null });
    inp.addEventListener('change', function () { onchange(inp.checked, inp); });
    return A.el('label.switch', null, inp, A.el('span'));
  };
  A.seg = function (options, value, onchange) {
    var s = A.el('div.seg', { role: 'group' });
    options.forEach(function (o) {
      var b = A.el('button', { type: 'button', 'aria-pressed': String(o[0] === value), text: o[1] });
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(s.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        onchange(o[0]);
      });
      s.appendChild(b);
    });
    return s;
  };

  /* Server */
  A.api = function (path, opts) {
    if (!window.Helix) return Promise.reject(new Error('Kein Helix-Server erreichbar.'));
    return window.Helix.json(path, opts);
  };
  A.fs = window.Helix ? window.Helix.fs : null;
  A.errText = function (e) { return HX ? HX.errText(e) : (e && e.message) || String(e); };
  A.fmt = HX ? HX.fmt : { bytes: String, date: String, time: String, ago: String };

  /* Fenster und Desktop */
  A.win = function () { return HX ? HX.wm.byWindow(window) : null; };
  A.setTitle = function (t) { document.title = t; var w = A.win(); if (w) HX.wm.setTitle(w, t); };
  A.close = function () { var w = A.win(); if (w) HX.wm.close(w); };
  A.open = function (id, params, opts) { return HX && HX.shell.openApp(id, params, opts); };
  A.openFile = function (root, path, appId) { if (HX) HX.shell.openFile(root, path, appId); };
  A.openUrl = function (url) { if (HX) HX.shell.openUrl(url); else window.open(url, '_blank'); };
  A.toast = function (t) { if (HX) HX.toast(t); else console.log(t); };
  A.notify = function (o) { if (HX) HX.notify(o); };
  A.confirm = function (o) { return HX ? HX.confirm(o) : Promise.resolve(window.confirm(o.text || o.title || o)); };
  A.prompt = function (o) { return HX ? HX.prompt(o) : Promise.resolve(window.prompt(o.title || o, o.value || '')); };
  A.alert = function (o) { return HX ? HX.alert(o) : Promise.resolve(window.alert(o.text || o)); };
  /** Menü an Klick-Position oder unter einem Element dieses Fensters. */
  A.menu = function (items, at) {
    if (!HX) return;
    var fr = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    var pt;
    if (at && at.getBoundingClientRect) {
      var r = at.getBoundingClientRect();
      pt = { getBoundingClientRect: function () { return { left: fr.left + r.left, right: fr.left + r.right, top: fr.top + r.top, bottom: fr.top + r.bottom, width: r.width, height: r.height }; } };
    } else if (at) pt = { x: fr.left + at.x, y: fr.top + at.y };
    return HX.menu(items, pt);
  };
  /** Ereignisse vom Desktop – werden beim Schließen des Fensters abgemeldet. */
  var offs = [];
  A.on = function (type, fn) { if (HX) offs.push(HX.on(type, fn)); };
  window.addEventListener('pagehide', function () { offs.forEach(function (f) { f(); }); offs = []; });
  A.on('theme', function (t) { document.documentElement.setAttribute('data-theme', t); });

  /** „Zurück“ von Android: fn() gibt true zurück, wenn die App es selbst erledigt hat. */
  A.onBack = function (fn) { window.hxBack = fn; };
  /** Erneutes Öffnen mit anderen Parametern (statt neu laden). */
  A.onNavigate = function (fn) { window.hxNavigate = function (u) { A.params = u.searchParams; fn(u.searchParams); }; };

  /** Langes Drücken / Rechtsklick. */
  A.longPress = function (n, fn) {
    var t = null, fired = false, sx = 0, sy = 0;
    n.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!fired) fn({ x: e.clientX, y: e.clientY }); });
    n.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      fired = false; sx = e.clientX; sy = e.clientY;
      t = setTimeout(function () { fired = true; fn({ x: sx, y: sy }); if (navigator.vibrate) navigator.vibrate(12); }, 520);
    });
    n.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) clearTimeout(t); });
    n.addEventListener('pointerup', function () { clearTimeout(t); });
    n.addEventListener('pointercancel', function () { clearTimeout(t); });
    n.addEventListener('click', function (e) { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  };

  /** Datei auswählen (Upload aus Android/Browser). */
  A.pickFiles = function (accept, multiple) {
    return new Promise(function (res) {
      var i = A.el('input', { type: 'file', accept: accept || null, multiple: !!multiple, style: { display: 'none' } });
      i.addEventListener('change', function () { res(Array.prototype.slice.call(i.files || [])); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  };
})();
