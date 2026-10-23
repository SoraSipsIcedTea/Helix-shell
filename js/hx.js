/* Helix-Desktop: Grundlagen – DOM-Helfer, Server, Einstellungen, Ereignisse, Dialoge, Menüs, Hinweise.
 * Alles hängt an window.HX; die System-Apps erreichen es als parent.HX. */
(function () {
  'use strict';

  var HX = window.HX = {};
  try {
    var lp = JSON.parse(localStorage.getItem('hx.prefs') || 'null');
    if (lp && (lp.theme === 'amoled' || lp.theme === 'mono')) document.documentElement.setAttribute('data-variant', lp.theme);
  } catch (e) { }
  var H = window.Helix;   // vom Helix-Server eingefügt (boot.js), im Desktop mit System-Rechten
  HX.native = H || null;

  /* ------------------------------------------------------------------ DOM */
  function el(tag, attrs) {
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
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(n, x); }); return; }
    n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function icon(name, cls) {
    var s = document.createElement('span');
    s.className = 'ic' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      ((window.HXI && window.HXI[name]) || window.HXI['square']) + '</svg>';
    return s;
  }
  HX.el = el; HX.icon = icon;
  HX.$ = function (sel, root) { return (root || document).querySelector(sel); };
  HX.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  /* ------------------------------------------------------------------ Server */
  HX.api = function (path, opts) {
    if (!H) return Promise.reject(new Error('Kein Helix-Server – der Desktop läuft ohne Backend.'));
    return H.json(path, opts);
  };
  HX.online = !!H;

  /* ------------------------------------------------------------------ Ereignisse */
  var subs = {};
  HX.on = function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { HX.off(type, fn); }; };
  HX.off = function (type, fn) { var l = subs[type]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  HX.emit = function (type, data) {
    (subs[type] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error('[HX]', type, e); } });
  };

  /* ------------------------------------------------------------------ Einstellungen (überleben Desktop-Updates) */
  var DEFAULTS = {
    theme: 'dark',            // dark | light | auto | amoled (echtes Schwarz) | mono (Schwarz, Graustufen)
    lastDark: 'dark',         // welche dunkle Darstellung der Schalter „Dunkel“ zurückholt
    wallpaper: 'nacht',
    mode: 'auto',             // auto | desktop | mobile
    scale: 100,               // Darstellung in Prozent: kleiner = mehr Platz, wie ein größerer Bildschirm
    dock: ['sys:files', 'sys:appcenter', 'sys:terminal', 'sys:settings'],
    desktopIcons: true,
    deskHidden: [],           // App-ids, die nicht auf dem Desktop bzw. der Startseite stehen
    iconSize: 'mittel',       // klein | mittel | gross
    bars: 'kompakt',          // kompakt | normal – Höhe von Leiste oben, Leiste unten und Titelzeilen
    panelHide: 'nie',         // nie | vollbild | immer – Leiste oben ausblenden
    clockPos: 'mitte',        // mitte | rechts
    clockDate: true,          // Datum neben der Uhr (Desktop-Ansicht)
    panelClock: 'auto',       // auto | immer | nie – Uhr und Status oben; auto: nur ohne sichtbare Android-Statusleiste
    homeClock: true,          // große Uhr auf der Startseite (Handy-Ansicht)
    batteryPct: true,
    dockPos: 'links',         // links | unten | rechts (Desktop-Ansicht)
    dockMode: 'neben',        // neben | ueber | auto – Fenster neben dem Dock, über dem Dock, Dock ausblenden
    dockSize: 'mittel',       // klein | mittel | gross
    mobileDock: false,        // Handy: Favoritenleiste mit offenen Fenstern in der unteren Leiste
    accent: 'tuerkis',
    wallDim: 0,               // 0 | 1 | 2 – Hintergrund abdunkeln
    seconds: false,
    restore: true,
    session: [],
    pins: [],
    notes: []
  };
  var prefs = JSON.parse(JSON.stringify(DEFAULTS));
  var saveTimer = null;
  HX.prefs = {
    load: function () {
      var local = null;
      try { local = JSON.parse(localStorage.getItem('hx.prefs') || 'null'); } catch (e) { }
      var p = H ? HX.api('/api/desktop/prefs').catch(function () { return local; }) : Promise.resolve(local);
      return p.then(function (o) {
        if (o && typeof o === 'object') for (var k in o) prefs[k] = o[k];
        return prefs;
      });
    },
    get: function (k) { return k == null ? prefs : prefs[k]; },
    set: function (k, v) {
      prefs[k] = v;
      HX.emit('prefs', k);
      HX.prefs.save();
    },
    save: function (now) {
      clearTimeout(saveTimer);
      var go = function () {
        try { localStorage.setItem('hx.prefs', JSON.stringify(prefs)); } catch (e) { }
        if (H) HX.api('/api/desktop/prefs', { method: 'PUT', json: prefs }).catch(function (e) { console.warn('[HX] prefs', e); });
      };
      if (now) go(); else saveTimer = setTimeout(go, 400);
    },
    defaults: DEFAULTS
  };

  /* ------------------------------------------------------------------ Formate */
  var dtf = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  HX.fmt = {
    bytes: function (n) {
      if (n == null || n < 0) return '';
      if (n < 1024) return n + ' B';
      var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
      do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
      return n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' ' + u[i];
    },
    time: function (d, sec) {
      return d.toLocaleTimeString('de-DE', sec ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
    },
    day: function (d) { return dtf.format(d); },
    date: function (t) {
      if (!t) return '';
      var d = new Date(t), now = new Date();
      if (d.toDateString() === now.toDateString()) return 'Heute, ' + HX.fmt.time(d);
      var y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return 'Gestern, ' + HX.fmt.time(d);
      return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + HX.fmt.time(d);
    },
    ago: function (t) {
      var s = Math.round((Date.now() - t) / 1000);
      if (s < 60) return 'gerade eben';
      if (s < 3600) return 'vor ' + Math.round(s / 60) + ' Min.';
      if (s < 86400) return 'vor ' + Math.round(s / 3600) + ' Std.';
      return HX.fmt.date(t);
    }
  };
  HX.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  HX.errText = function (e) {
    if (!e) return 'Unbekannter Fehler';
    if (e.name === 'AbortError') return 'Abgebrochen';
    return e.message || String(e);
  };

  /* ------------------------------------------------------------------ App-Icons */
  HX.appIcon = function (app, size) {
    var n;
    if (app && app.iconUrl) {
      n = el('span.appicon.img');
      var img = el('img', { src: app.iconUrl, alt: '', draggable: 'false', loading: 'lazy' });
      img.onerror = function () { n.classList.remove('img'); n.innerHTML = ''; n.appendChild(letter(app)); paint(n, app); };
      n.appendChild(img);
    } else {
      n = el('span.appicon');
      if (app && app.glyph) n.appendChild(icon(app.glyph, 'glyph'));
      else n.appendChild(letter(app));
      paint(n, app);
    }
    if (size) { n.style.width = size + 'px'; n.style.height = size + 'px'; }
    return n;
  };
  function letter(app) {
    var t = ((app && app.name) || '?').trim().charAt(0).toUpperCase();
    return el('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: '1.1em' }, text: t });
  }
  var PALETTE = [['#2DD4BF', '#0E6F66'], ['#F6C08C', '#B66A2C'], ['#7DA2FF', '#3550B8'], ['#C79BFF', '#6C3FB8'], ['#FF9AAE', '#B23B5A'], ['#9BE37D', '#3E8A2B']];
  function paint(n, app) {
    var c = app && app.colors;
    if (!c) {
      var s = (app && (app.id || app.name)) || '', h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      c = PALETTE[h % PALETTE.length];
    }
    n.style.setProperty('--a', c[0]);
    n.style.setProperty('--b', c[1]);
  }
  HX.mark = function () {
    // Die Helix: zwei Stränge, Türkis und Pfirsich.
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('class', 'mark'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<path class="s1" d="M10 4c0 6 12 6 12 12s-12 6-12 12" fill="none" stroke="#2DD4BF" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="s2" d="M22 4c0 6-12 6-12 12s12 6 12 12" fill="none" stroke="#F6C08C" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="16" cy="16" r="2.2" fill="#fff"/>';
    return s;
  };

  /* ------------------------------------------------------------------ Ebenen: Menü, Dialog, Hinweis */
  var layers = [];      // offene Menüs/Dialoge – „Zurück“ schließt die oberste
  HX.layers = layers;
  function pushLayer(close) { layers.push(close); return function () { var i = layers.indexOf(close); if (i >= 0) layers.splice(i, 1); }; }
  HX.closeTopLayer = function () { var c = layers[layers.length - 1]; if (c) { c(); return true; } return false; };
  HX.pushLayer = pushLayer;

  /** Kontextmenü. items: [{label, icon, run, danger, disabled} | '-' | {head}] ; at: {x,y} oder Element */
  var openMenu = null;
  HX.menu = function (items, at, opts) {
    opts = opts || {};
    if (openMenu) openMenu();   // immer nur ein Menü
    var scrim = el('div.scrim');
    var pop = el('div.pop', { role: 'menu' });
    if (opts.className) pop.className += ' ' + opts.className;
    var done = false, born = Date.now(), downOnScrim = false;
    var close = function () { if (done) return; done = true; if (openMenu === close) openMenu = null; drop(); scrim.remove(); pop.remove(); if (opts.onClose) opts.onClose(); };
    var drop = pushLayer(close);
    openMenu = close;
    items.forEach(function (it) {
      if (!it) return;
      if (it === '-') { pop.appendChild(el('div.menu-sep')); return; }
      if (it.head) { pop.appendChild(el('div.menu-head', { text: it.head })); return; }
      if (it.node) { pop.appendChild(it.node); return; }
      var b = el('button.menu-item', { type: 'button', role: 'menuitem', disabled: !!it.disabled, class: it.danger ? 'danger' : null },
        it.icon ? icon(it.icon) : null, el('span', { text: it.label }));
      b.addEventListener('click', function () { close(); if (it.run) setTimeout(it.run, 0); });
      pop.appendChild(b);
    });
    // Geschlossen wird erst durch ein neues Antippen außerhalb: Drücken UND Loslassen auf dem Hintergrund.
    // Das Loslassen nach langem Drücken oder das contextmenu-Ereignis, das Android nach dem langen
    // Drücken nachschiebt, landen sonst auf dem Hintergrund und schlössen das Menü sofort wieder.
    var young = function () { return Date.now() - born < 450; };
    scrim.addEventListener('pointerdown', function (e) { e.preventDefault(); downOnScrim = !young(); });
    scrim.addEventListener('pointerup', function () { if (downOnScrim) close(); downOnScrim = false; });
    scrim.addEventListener('pointercancel', function () { downOnScrim = false; });
    scrim.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!young()) close(); });
    scrim.addEventListener('wheel', function () { if (!young()) close(); }, { passive: true });
    document.body.appendChild(scrim);
    document.body.appendChild(pop);
    place(pop, at);
    var first = pop.querySelector('.menu-item:not([disabled])');
    if (first && !opts.noFocus) first.focus({ preventScroll: true });
    pop.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Ein Klick, der vom öffnenden Drücken übrig ist, löst keinen Menüpunkt aus.
    pop.addEventListener('click', function (e) { if (Date.now() - born < 300) { e.stopPropagation(); e.preventDefault(); } }, true);
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var list = Array.prototype.slice.call(pop.querySelectorAll('.menu-item:not([disabled])'));
      var i = list.indexOf(document.activeElement);
      i = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      if (list[i]) list[i].focus();
      e.preventDefault();
    });
    return { close: close, el: pop };
  };
  HX.popover = function (content, at, opts) {
    return HX.menu([{ node: content }], at, Object.assign({ noFocus: true }, opts || {}));
  };
  function place(pop, at) {
    var W = window.innerWidth, Ht = window.innerHeight, r = pop.getBoundingClientRect();
    var x, y;
    if (at && at.getBoundingClientRect) {
      var b = at.getBoundingClientRect();
      x = b.left; y = b.bottom + 6;
      if (y + r.height > Ht - 8) y = Math.max(8, b.top - r.height - 6);
      if (b.left > W / 2) x = b.right - r.width;
    } else { x = at ? at.x : W / 2 - r.width / 2; y = at ? at.y : Ht / 2 - r.height / 2; }
    if (x + r.width > W - 8) x = W - r.width - 8;
    if (y + r.height > Ht - 8) y = Ht - r.height - 8;
    pop.style.left = Math.max(8, x) + 'px';
    pop.style.top = Math.max(8, y) + 'px';
  }

  function dialog(o) {
    return new Promise(function (resolve) {
      var input = null;
      var wrap = el('div.dialog-wrap');
      var box = el('div.dialog', { role: 'dialog', 'aria-modal': 'true' });
      if (o.title) box.appendChild(el('h3', { text: o.title }));
      if (o.text) box.appendChild(el('p', { text: o.text }));
      if (o.node) box.appendChild(o.node);
      if (o.input) {
        input = el('input.field', { value: o.value || '', placeholder: o.placeholder || '', spellcheck: 'false', autocomplete: 'off' });
        box.appendChild(input);
      }
      var done = false;
      var finish = function (v) { if (done) return; done = true; drop(); wrap.remove(); resolve(v); };
      var drop = pushLayer(function () { finish(o.input ? null : false); });
      var actions = el('div.actions');
      if (o.cancel !== false) actions.appendChild(el('button.btn.ghost', { type: 'button', text: o.cancel || 'Abbrechen', onclick: function () { finish(o.input ? null : false); } }));
      var ok = el('button.btn', { type: 'button', class: o.danger ? 'danger' : 'primary', text: o.ok || 'OK',
        onclick: function () { finish(o.input ? input.value : true); } });
      actions.appendChild(ok);
      box.appendChild(actions);
      wrap.appendChild(box);
      wrap.addEventListener('pointerdown', function (e) { if (e.target === wrap && o.cancel !== false) finish(o.input ? null : false); });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && o.cancel !== false) finish(o.input ? null : false);
        if (e.key === 'Enter' && (input ? e.target === input : true)) { e.preventDefault(); ok.click(); }
      });
      document.body.appendChild(wrap);
      setTimeout(function () { if (input) { input.focus(); input.select(); } else ok.focus(); }, 30);
    });
  }
  HX.confirm = function (o) { return dialog(typeof o === 'string' ? { text: o } : o); };
  HX.alert = function (o) { o = typeof o === 'string' ? { text: o } : o; return dialog(Object.assign({ cancel: false }, o)); };
  HX.prompt = function (o) { return dialog(Object.assign({ input: true }, typeof o === 'string' ? { title: o } : o)); };
  HX.dialog = dialog;

  /* Hinweise (oben rechts) und das Benachrichtigungsprotokoll im Kalender-Blatt */
  HX.notify = function (o) {
    if (typeof o === 'string') o = { title: o };
    var host = document.getElementById('toasts');
    var t = el('div.toast', { role: 'status', class: o.run ? 'action' : null },
      o.app ? HX.appIcon(o.app, 30) : el('span.appicon', { style: { width: '30px', height: '30px', borderRadius: '9px' } }, HX.mark()),
      el('div', null, el('b', { text: o.title || '' }), o.body ? el('span', { text: o.body }) : null),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Schließen', onclick: function (e) { e.stopPropagation(); t.remove(); } }, icon('x')));
    if (o.run) t.addEventListener('click', function () { t.remove(); o.run(); });
    host.appendChild(t);
    while (host.children.length > 4) host.firstChild.remove();
    setTimeout(function () { t.remove(); }, o.ms || (o.body && o.body.length > 80 ? 9000 : 5000));
    if (o.log !== false) {
      var notes = (prefs.notes || []).slice(-29);
      notes.push({ t: Date.now(), title: o.title || '', body: o.body || '', app: o.app ? o.app.id : '' });
      prefs.notes = notes;
      HX.prefs.save();
      HX.emit('notes');
    }
  };
  HX.toast = function (text) { HX.notify({ title: text, log: false, ms: 3500 }); };
})();
