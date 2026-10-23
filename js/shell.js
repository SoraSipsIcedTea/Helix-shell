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
      layoutChrome();
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
    document.addEventListener('fullscreenchange', layoutChrome);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    HX.on('apps', function () { renderDock(); renderDesk(); if (state.launcher) renderLauncher(); });
    HX.on('windows', function () { renderActive(); renderDock(); if (state.overview) layoutOverview(); renderNavBadge(); deskFree(); applyTint(); });
    HX.on('focus', function (w) { renderActive(w); renderDock(); applyTint(); });
    // System-Apps melden keine Farbe, der Desktop liest sie selbst ab (gleicher Origin)
    setInterval(function () { var w = WM.focused(); if (w && w.app.system && !w.min) applyTint(); }, 1500);
    HX.on('title', function (w) { if (w === WM.focused()) renderActive(w); });
    HX.on('session', saveSession);
    HX.on('prefs', function (k) {
      if (k === 'theme' || k === 'accent') applyTheme();
      if (k === 'wallpaper' || k === 'wallDim') applyWallpaper();
      if (k === 'mode') applyMode();
      if (k === 'dock') renderDock();
      if (k === 'pins' || k === 'desktopIcons' || k === 'deskHidden') renderDesk();
      if (k === 'seconds' || k === 'clockDate') tick();
      if (k === 'batteryPct') renderStatus();
      if (CHROME_KEYS.indexOf(k) >= 0) layoutChrome();
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
  /* Akzentfarbe (Strang 1). Je Farbe eine Variante für Dunkel und Hell, damit Text darauf lesbar bleibt. */
  var ACCENTS = HX.accents = [
    { id: 'tuerkis', name: 'Türkis', dark: ['#2DD4BF', '#062A26'], light: ['#0F9C8C', '#FFFFFF'] },
    { id: 'blau', name: 'Blau', dark: ['#7DA2FF', '#0A1640'], light: ['#3559C9', '#FFFFFF'] },
    { id: 'violett', name: 'Violett', dark: ['#C79BFF', '#24104A'], light: ['#7A45C9', '#FFFFFF'] },
    { id: 'rosa', name: 'Rosa', dark: ['#FF9AB8', '#3F0E1E'], light: ['#C2416A', '#FFFFFF'] },
    { id: 'gruen', name: 'Grün', dark: ['#8FE07A', '#10300A'], light: ['#3C8F2A', '#FFFFFF'] },
    { id: 'gold', name: 'Gold', dark: ['#F2C95C', '#3A2A05'], light: ['#A87A0E', '#FFFFFF'] }
  ];
  function accentNow() {
    var a = ACCENTS.filter(function (x) { return x.id === HX.prefs.get('accent'); })[0] || ACCENTS[0];
    return themeNow() === 'light' ? a.light : a.dark;
  }
  function paintAccent(root) {
    var v = accentNow();
    root.style.setProperty('--teal', v[0]);
    root.style.setProperty('--teal-ink', v[1]);
  }
  function applyTheme() {
    var t = themeNow();
    document.documentElement.setAttribute('data-theme', t);
    paintAccent(document.documentElement);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F6F8FB' : '#0B1020');
    WM.wins.forEach(function (w) {
      if (w.app.system) applyThemeTo(w.frame.contentWindow);
      else WM.post(w, 'theme', { theme: t, accent: accentNow()[0] }, 100);
    });
    applyTint();
    HX.emit('theme', t);
  }
  function applyThemeTo(cw) {
    try { cw.document.documentElement.setAttribute('data-theme', themeNow()); paintAccent(cw.document.documentElement); } catch (e) { }
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
    document.documentElement.style.setProperty('--wall-dim', String([0, .22, .42][HX.prefs.get('wallDim') | 0] || 0));
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
      renderActive();
      renderDock();
    }
    layoutChrome();
  }

  /* ================================================================== Leisten und Dock: Maße und Lage
   * Alles, was Fenster und Arbeitsfläche an Platz kostet, rechnet layoutChrome() aus und legt es als
   * CSS-Variablen ab: --top (Inhalt beginnt), --res-* (Platz, den Fenster frei lassen), --dres-* (Platz, den
   * die Arbeitsfläche frei lässt). WM.area() liest dieselben Werte. */
  var SIZES = {
    bars: { kompakt: { panel: 28, nav: 50, bar: 32 }, normal: { panel: 34, nav: 60, bar: 40 } },
    dock: { klein: { w: 54, item: 42, icon: 30 }, mittel: { w: 66, item: 52, icon: 40 }, gross: { w: 80, item: 64, icon: 50 } },
    icons: { klein: { icon: 38, cell: 80, home: 46 }, mittel: { icon: 48, cell: 92, home: 54 }, gross: { icon: 60, cell: 108, home: 64 } }
  };
  var CHROME_KEYS = ['bars', 'panelHide', 'clockPos', 'dockPos', 'dockMode', 'dockSize', 'mobileDock', 'iconSize'];
  var ins = { top: 0, bottom: 0, left: 0, right: 0, fs: null, cut: null };
  /** Vollbild: Android meldet es mit (Statusleiste weg); ältere Helix-Versionen nur über die Fullscreen-API. */
  function fullscreen() { return ins.fs != null ? !!ins.fs : !!document.fullscreenElement; }
  function layoutChrome() {
    var P = HX.prefs.get(), root = document.documentElement, b = document.body;
    var set = function (k, v) { root.style.setProperty(k, v + 'px'); };
    var bars = SIZES.bars[P.bars] || SIZES.bars.kompakt;
    var dk = SIZES.dock[P.dockSize] || SIZES.dock.mittel;
    var ic = SIZES.icons[P.iconSize] || SIZES.icons.mittel;
    var mob = state.mobile, fs = fullscreen(), sat = ins.top;
    var hide = P.panelHide === 'immer' || (P.panelHide === 'vollbild' && fs);
    // Im Vollbild ist oben nur noch der Streifen der Kamera-Aussparung. Die Leiste rückt hinein, statt darunter.
    var merged = fs && sat > 0 && !hide;
    var total = merged ? Math.max(bars.panel, sat) : bars.panel + sat;
    set('--panel-h', bars.panel); set('--panel-pt', merged ? 0 : sat); set('--panel-total', total);
    set('--top', hide ? sat : total);
    set('--nav-h', bars.nav); set('--bar-h', bars.bar);
    set('--dock-w', dk.w); set('--dock-item', dk.item); set('--dock-icon', dk.icon);
    set('--desk-icon', ic.icon); set('--desk-cell', ic.cell); set('--home-icon', ic.home);
    // Aussparung im Streifen: Leiste weicht ihr aus (Mitte: Uhr nach rechts, links nur bis zur Kamera).
    root.style.removeProperty('--cut-pl'); root.style.removeProperty('--cut-pr'); root.style.removeProperty('--cut-lmax');
    var clockRight = P.clockPos === 'rechts';
    if (merged) {
      var W = window.innerWidth, c = ins.cut;
      if (c && c.r > c.l) {
        var mid = (c.l + c.r) / 2;
        if (mid < W * 0.3) set('--cut-pl', Math.max(0, c.r + 4 - ins.left));
        else if (mid > W * 0.7) set('--cut-pr', Math.max(0, W - c.l + 4 - ins.right));
        else { clockRight = true; set('--cut-lmax', Math.max(60, c.l - 16 - ins.left)); }
      } else clockRight = true;   // Lage unbekannt: die Mitte frei lassen, dort sitzt meist die Kamera
    }
    // Dock: Lage und ob Fenster daneben, darüber oder bei ausgeblendetem Dock liegen
    var pos = P.dockPos === 'unten' || P.dockPos === 'rechts' ? P.dockPos : 'links';
    var mode = P.dockMode === 'ueber' || P.dockMode === 'auto' ? P.dockMode : 'neben';
    var space = dk.w + 16, dres = { l: 0, r: 0, b: 0 };
    if (mob) dres.b = bars.nav;
    else if (pos === 'unten') dres.b = space; else if (pos === 'rechts') dres.r = space; else dres.l = space;
    var res = mob || mode === 'neben' ? dres : { l: 0, r: 0, b: 0 };
    ['l', 'r', 'b'].forEach(function (k) { set('--res-' + k, res[k]); set('--dres-' + k, dres[k]); });
    var cls = {
      'bars-normal': P.bars === 'normal', 'panel-hidden': hide, 'panel-merged': merged, 'clock-right': clockRight,
      'dock-left': !mob && pos === 'links', 'dock-bottom': !mob && pos === 'unten', 'dock-right': !mob && pos === 'rechts',
      'dock-over': !mob && mode === 'ueber', 'dock-auto': !mob && mode === 'auto', 'mdock': mob && !!P.mobileDock
    };
    Object.keys(cls).forEach(function (k) { b.classList.toggle(k, cls[k]); });
    if (!hide) b.classList.remove('panel-peek');
    deskFree();
    WM.layoutAll();
    if (state.overview) layoutOverview();
    applyTint();
  }
  shell.layout = layoutChrome;
  /** Ohne sichtbare Fenster zeigt sich ein ausgeblendetes Dock von selbst. */
  function deskFree() { document.body.classList.toggle('desk-free', !WM.visible().length); }

  /* Leiste oben hervorholen (wenn ausgeblendet): Griff antippen oder mit der Maus an den oberen Rand */
  var peekT = null;
  function peekPanel(on, ms) {
    clearTimeout(peekT);
    document.body.classList.toggle('panel-peek', !!on && document.body.classList.contains('panel-hidden'));
    if (on && ms) peekT = setTimeout(function again() {
      if (HX.layers.length) { peekT = setTimeout(again, 1200); return; }   // solange ein Menü der Leiste offen ist
      document.body.classList.remove('panel-peek');
    }, ms);
  }
  /* Dock hervorholen (Fenster über dem Dock oder Dock ausgeblendet): an den Rand zeigen oder tippen */
  var dockT = null;
  function peekDock(on, ms) {
    clearTimeout(dockT);
    document.body.classList.toggle('dock-peek', !!on);
    if (on && ms) dockT = setTimeout(function again() {
      if (HX.layers.length) { dockT = setTimeout(again, 1200); return; }
      document.body.classList.remove('dock-peek');
    }, ms);
  }
  shell.isMobile = function () { return state.mobile; };

  /* ================================================================== Leisten in der Farbe der App
   * Füllt ein Fenster den Bildschirm (Handy-Ansicht oder maximiert), nehmen Leiste oben und Leiste unten die
   * Farbe des oberen bzw. unteren App-Rands an, die Symbole von Android werden passend hell oder dunkel.
   * Auf dem Desktop selbst, in Übersicht und Starter bleiben sie wie sie sind. */
  var rgbCache = {};
  function rgbOf(c) {
    if (!c) return null;
    if (rgbCache[c]) return rgbCache[c];
    var d = document.createElement('div'); d.style.color = 'rgb(1, 2, 3)'; d.style.color = c;
    document.body.appendChild(d);
    var m = (getComputedStyle(d).color.match(/[\d.]+/g) || []).map(Number); d.remove();
    if (m.length < 3 || (m[0] === 1 && m[1] === 2 && m[2] === 3 && !/^rgb\(\s*1\D+2\D+3\D/.test(c))) return null;   // ungültige Farbe
    if (m.length > 3 && m[3] < 0.85) return null;
    return (rgbCache[c] = m.slice(0, 3));
  }
  function isDark(rgb) { return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 < 0.6; }
  /** Farben einer System-App direkt aus dem Dokument (theme-color, sonst Hintergrund am Rand). */
  function sysColors(w) {
    try {
      var d = w.frame.contentDocument, v = w.frame.contentWindow;
      var at = function (y) {
        var n = d.elementFromPoint(Math.round(v.innerWidth / 2), y);
        while (n && n.nodeType === 1) { var c = v.getComputedStyle(n).backgroundColor; if (rgbOf(c)) return c; n = n.parentElement; }
        return v.getComputedStyle(d.body).backgroundColor;
      };
      var meta = d.querySelector('meta[name="theme-color"]');
      return { top: (meta && meta.content) || at(1), bottom: at(Math.max(0, v.innerHeight - 2)) };
    } catch (e) { return { top: null, bottom: null }; }
  }
  var barsKey = '';
  function applyTint() {
    var w = WM.focused(), root = document.documentElement, b = document.body;
    var on = !!(w && !w.min && !state.overview && !state.launcher && (state.mobile || w.max));
    var top = null, bot = null;
    if (on) {
      var c = w.app.system ? sysColors(w) : { top: w.tintTop, bottom: w.tintBottom };
      top = rgbOf(c.top); bot = rgbOf(c.bottom) || top;
    }
    var css = function (rgb) { return 'rgb(' + rgb.join(', ') + ')'; };
    if (top) { root.style.setProperty('--tint-top', css(top)); root.style.setProperty('--tint-top-ink', isDark(top) ? '#F4F7FB' : '#121A33'); }
    if (bot) { root.style.setProperty('--tint-bot', css(bot)); root.style.setProperty('--tint-bot-ink', isDark(bot) ? '#F4F7FB' : '#121A33'); }
    b.classList.toggle('tint-top', !!top);
    b.classList.toggle('tint-bot', !!bot && state.mobile);
    // Symbole von Android: oben nach der Leiste oben, unten nach der Leiste unten (Handy) bzw. dem Desktop
    var themeDark = themeNow() !== 'light';
    var statusLight = top ? isDark(top) : themeDark;
    var navLight = bot && state.mobile ? isDark(bot) : (top && !state.mobile ? isDark(top) : themeDark);
    var key = statusLight + '|' + navLight;
    if (H && key !== barsKey) {
      barsKey = key;
      HX.api('/api/system/bars', { method: 'POST', json: { statusLight: statusLight, navLight: navLight, light: !statusLight } }).catch(function () { barsKey = ''; });
    }
  }
  shell.tint = applyTint;

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
    var panel = $('panel');
    panel.addEventListener('pointerenter', function () { if (document.body.classList.contains('panel-peek')) clearTimeout(peekT); });
    panel.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') peekPanel(true, 700); });
    panel.addEventListener('contextmenu', function (e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      barsMenu({ x: e.clientX, y: e.clientY });
    });
    var grip = el('button', { id: 'p-grip', type: 'button', 'aria-label': 'Leiste oben zeigen', title: 'Leiste zeigen' }, el('span'));
    grip.addEventListener('click', function () { peekPanel(true, 4000); });
    var edge = el('div', { id: 'p-edge', 'aria-hidden': 'true' });
    // Maus an den Rand: zeigen; wer nicht in die Leiste fährt, sieht sie nach kurzer Zeit wieder verschwinden.
    edge.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') peekPanel(true, 1500); });
    document.body.appendChild(grip);
    document.body.appendChild(edge);
    renderStatus();
  }
  /** Schnellwahl für Leisten und Dock (Rechtsklick auf die Leiste oder den Dock-Hintergrund). */
  function barsMenu(at) {
    var P = HX.prefs.get(), items = [];
    var pick = function (k, v, label, ic) { items.push({ label: label + (P[k] === v ? '  ✓' : ''), icon: ic, run: function () { HX.prefs.set(k, v); } }); };
    items.push({ head: 'Leisten' });
    pick('bars', 'kompakt', 'Kompakt', 'minimize-2');
    pick('bars', 'normal', 'Normal', 'maximize-2');
    pick('panelHide', 'nie', 'Leiste oben immer zeigen', 'panel-top');
    pick('panelHide', 'vollbild', 'Im Vollbild ausblenden', 'panel-top');
    pick('panelHide', 'immer', 'Immer ausblenden', 'eye-off');
    if (!state.mobile) {
      items.push('-'); items.push({ head: 'Dock' });
      pick('dockPos', 'links', 'Links', 'panel-left');
      pick('dockPos', 'unten', 'Unten', 'panel-bottom');
      pick('dockPos', 'rechts', 'Rechts', 'panel-right');
      pick('dockMode', 'neben', 'Fenster neben dem Dock', 'app-window');
      pick('dockMode', 'ueber', 'Fenster über dem Dock', 'layers');
      pick('dockMode', 'auto', 'Dock ausblenden', 'eye-off');
    } else {
      items.push('-');
      items.push({ label: 'Favoritenleiste unten' + (P.mobileDock ? '  ✓' : ''), icon: 'star', run: function () { HX.prefs.set('mobileDock', !P.mobileDock); } });
    }
    items.push('-');
    items.push({ label: 'Desktop anpassen …', icon: 'sliders-horizontal', run: function () { shell.openApp('sys:settings', { page: 'desktop' }); } });
    HX.menu(items, at);
  }
  /** Titel des Fensters im Vordergrund – nur in der Handy-Ansicht, dort ersetzt die Leiste die Titelzeile. */
  function renderActive(w) {
    if (w === undefined) w = WM.focused();
    var n = $('p-active'), c = HX.clear($('p-win'));
    var show = !!(w && !w.min && state.mobile);
    n.textContent = show ? w.title : '';
    n.hidden = !show;
    c.hidden = !show;
    if (!show) return;
    var more = el('button', { type: 'button', 'aria-label': 'Fenstermenü', title: 'Fenstermenü' }, icon('ellipsis-vertical'));
    more.addEventListener('click', function () { WM.menu(w, more); });
    c.appendChild(more);
    c.appendChild(el('button', { type: 'button', 'aria-label': 'Fenster schließen', title: 'Schließen', onclick: function () { WM.close(w); } }, icon('x')));
  }
  var lastMin = -1;
  function tick() {
    var d = new Date(), sec = HX.prefs.get('seconds');
    var date = !state.mobile && HX.prefs.get('clockDate') !== false;
    $('p-clock').textContent = (date ? d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }) + '  ' : '') + HX.fmt.time(d, sec);
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
      if (HX.prefs.get('batteryPct') !== false) s.appendChild(el('span', { text: Math.round(b.level * 100) + ' %' }));
    }
    s.appendChild(icon('power'));
    s.setAttribute('aria-label', 'Schnelleinstellungen');
  }

  /* ================================================================== Dock */
  function buildDock() {
    var d = $('dock');
    d.addEventListener('pointerenter', function () { clearTimeout(dockT); });
    d.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && document.body.classList.contains('dock-peek')) peekDock(true, 600); });
    d.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.dock-item, .nav-btn')) return;
      e.preventDefault();
      barsMenu({ x: e.clientX, y: e.clientY });
    });
    var edge = el('div', { id: 'dock-edge', 'aria-hidden': 'true' });
    edge.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') peekDock(true, 1500); });
    edge.addEventListener('click', function () { peekDock(true, 4000); });
    document.body.appendChild(edge);
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
        class: (running ? 'running' : '') + (f && f.app.id === id ? ' focused' : '') }, el('span.run'), HX.appIcon(app));
      b.addEventListener('click', function () { dockClick(app); });
      longPress(b, function (at) { appMenu(app, at); });
      list.appendChild(b);
    });
    renderNavBadge();
  }
  function dockClick(app) {
    if (document.body.classList.contains('dock-peek')) peekDock(true, 900);
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
    // Android schickt nach langem Drücken selbst ein contextmenu – wer zuerst kommt, öffnet das Menü, der andere nicht mehr.
    n.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      clearTimeout(t);
      if (fired) return;
      fired = true;
      fn({ x: e.clientX, y: e.clientY });
    });
    n.addEventListener('pointerdown', function (e) {
      fired = false;
      clearTimeout(t);
      if (e.pointerType === 'mouse') return;
      sx = e.clientX; sy = e.clientY;
      t = setTimeout(function () { if (fired) return; fired = true; fn({ x: sx, y: sy }); if (navigator.vibrate) navigator.vibrate(12); }, 520);
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
    var hidden = (HX.prefs.get('deskHidden') || []).indexOf(app.id) >= 0;
    var where = state.mobile ? 'Startseite' : 'Desktop';
    items.push({ label: hidden ? 'Auf ' + (state.mobile ? 'der Startseite' : 'dem Desktop') + ' zeigen' : (state.mobile ? 'Von der ' : 'Vom ') + where + ' entfernen', icon: hidden ? 'eye' : 'eye-off', run: function () {
      var h = (HX.prefs.get('deskHidden') || []).filter(function (x) { return x !== app.id; });
      if (!hidden) h.push(app.id);
      HX.prefs.set('deskHidden', h);
    } });
    if (!app.system) {
      items.push({ label: 'Auf den Startbildschirm', icon: 'smartphone', run: function () { shell.homeShortcut(app, app.url, app.name); } });
      items.push({ label: 'App-Infos', icon: 'info', run: function () { shell.openApp('sys:appcenter', { app: (app.pkg || app).id }); } });
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
    Apps.installed().filter(shown).forEach(function (a) { g.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
    (HX.prefs.get('pins') || []).forEach(function (p, i) { g.appendChild(pinIcon(p, i)); });
    d.appendChild(g);
  }
  function shown(a) { return (HX.prefs.get('deskHidden') || []).indexOf(a.id) < 0; }
  function deskIcon(app, run, menu) {
    var b = el('button.desk-icon', { type: 'button' }, HX.appIcon(app), el('span.label', { text: app.name }));
    b.addEventListener(state.mobile ? 'click' : 'dblclick', run);
    if (!state.mobile) b.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    if (menu) longPress(b, function (at) { appMenu(app, at); });
    return b;
  }
  function pinIcon(p, i) {
    var app = Apps.forUrl(p.url);
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

  /** Einzelne Apps zuerst („Deine Apps“), dann je Suite ein Abschnitt mit ihren Apps. */
  function groupApps(list) {
    var single = [], suites = {}, order = [];
    list.forEach(function (a) {
      if (!a.pkg) { single.push(a); return; }
      if (!suites[a.pkg.id]) { suites[a.pkg.id] = { title: a.pkg.name, suite: a.pkg, list: [] }; order.push(a.pkg.id); }
      suites[a.pkg.id].list.push(a);
    });
    var out = [];
    if (single.length) out.push({ title: 'Deine Apps', list: single });
    order.forEach(function (id) { out.push(suites[id]); });
    return out;
  }

  function homeView() {
    var d = new Date();
    var v = el('div.home', null,
      el('div.home-clock', { text: HX.fmt.time(d) }),
      el('div.home-date', { text: HX.fmt.day(d) }));
    var pins = HX.prefs.get('pins') || [];
    var groups = groupApps(Apps.installed().filter(shown));
    if (!groups.length && !pins.length) {
      v.appendChild(el('h2', { text: 'Deine Apps' }));
      v.appendChild(el('div.suite', { role: 'button', tabindex: '0', onclick: function () { shell.openApp('sys:appcenter'); } },
        HX.appIcon(Apps.get('sys:appcenter'), 46),
        el('div.t', null, el('div.n', { text: 'App hinzufügen' }), el('div.s', { text: 'Paket installieren oder einen Ordner verbinden' })),
        icon('chevron-right')));
    }
    groups.forEach(function (gr, gi) {
      v.appendChild(el('h2', { text: gr.title }));
      var g = el('div.home-grid');
      gr.list.forEach(function (a) { g.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
      if (gi === 0 && !gr.suite) pins.forEach(function (p, i) { g.appendChild(pinIcon(p, i)); });
      v.appendChild(g);
    });
    if (pins.length && (!groups.length || groups[0].suite)) {
      v.appendChild(el('h2', { text: 'Direktlinks' }));
      var pg = el('div.home-grid');
      pins.forEach(function (p, i) { pg.appendChild(pinIcon(p, i)); });
      v.appendChild(pg);
    }
    v.appendChild(el('h2', { text: 'Helix' }));
    var sg = el('div.home-grid');
    Apps.system.filter(shown).forEach(function (a) { sg.appendChild(deskIcon(a, function () { shell.openApp(a.id); }, true)); });
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
      applyTint();
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
    applyTint();
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
    groupApps(mine).forEach(function (gr) { section(gr.title, gr.list, mkApp); });
    section('Direktlinks', pins, function (p) {
      var app = Apps.forUrl(p.url);
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
    applyTint();
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
    applyTint();
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
    var app = Apps.forUrl(u.href);
    if (app) {
      // Eine Adresse einer App: im vorhandenen Fenster dieser App öffnen, sonst in einem neuen.
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
    app = app.pkg || app;
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
    /** Ränder von Android in CSS-Pixeln. fs: Statusleiste ausgeblendet (Vollbild). cut: {l, r} – waagrechte
     *  Lage der Kamera-Aussparung am oberen Rand, falls es eine gibt. */
    insets: function (i) {
      var r = document.documentElement.style;
      ins = { top: i.top || 0, bottom: i.bottom || 0, left: i.left || 0, right: i.right || 0,
        fs: typeof i.fs === 'boolean' ? i.fs : null, cut: i.cut && i.cut.r > i.cut.l ? i.cut : null };
      r.setProperty('--sat', ins.top + 'px');
      r.setProperty('--sab', ins.bottom + 'px');
      r.setProperty('--sal', ins.left + 'px');
      r.setProperty('--sar', ins.right + 'px');
      layoutChrome();
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
      case 'state':
        WM.setState(w, a);
        if (a.themeColor !== undefined) w.tintTop = a.themeColor || null;
        if (a.bottomColor !== undefined) w.tintBottom = a.bottomColor || null;
        if (w === WM.focused()) applyTint();
        if (!w.ready) {
          w.ready = true;
          WM.post(w, 'theme', { theme: themeNow(), accent: accentNow()[0] }, 100);   // Apps können Hell/Dunkel übernehmen
          HX.emit('ready', w);
        }
        break;
      case 'title': WM.setTitle(w, a.title); break;
      case 'close': WM.close(w); break;
      case 'notify':
        HX.notify({ title: String(a.title || w.app.name).slice(0, 120), body: String(a.body || '').slice(0, 600), app: w.app,
          run: function () { WM.restore(w); } });
        break;
      case 'open': {
        var target = Apps.resolve(a.app);
        if (!target) { HX.toast('„' + a.app + '“ ist nicht installiert.'); reply(false); break; }
        WM.open(target, { path: a.path || null });
        reply(true);
        break;
      }
      case 'send': {
        var to = Apps.resolve(a.app);
        if (!to) { reply({ delivered: 0, error: { name: 'NotFoundError', message: '„' + a.app + '“ ist nicht installiert.' } }); break; }
        sendTo(w, to, a, reply);
        break;
      }
      case 'open-url': if (a.url) openUrl(String(a.url)); break;
      case 'pin': shell.pin(w.app, String(a.url || w.url), String(a.title || w.title)); break;
      case 'update': shell.openApp('sys:appcenter', { app: w.app.id, check: 1 }); break;
    }
  }

  /** Nachricht einer App an eine andere: an alle offenen Fenster der Ziel-App (bzw. ihrer Suite). */
  function sendTo(fromWin, target, a, reply) {
    var from = { id: fromWin.app.id, name: fromWin.app.name, origin: fromWin.app.origin, suite: fromWin.app.pkg ? fromWin.app.pkg.id : null };
    var wins = WM.wins.filter(function (x) { return !x.app.system && x !== fromWin && Apps.belongs(x.app, target); });
    var deliver = function (list) {
      if (!a.request) {
        list.forEach(function (x) { WM.post(x, 'message', { from: from, data: a.data }, 200); });
        reply({ delivered: list.length });
        return;
      }
      if (!list.length) { reply({ delivered: 0, error: { name: 'NotFoundError', message: '„' + target.name + '“ ist nicht geöffnet.' } }); return; }
      WM.post(list[0], 'message', { from: from, data: a.data }, 14000).then(function (r) {
        reply(r ? Object.assign({ delivered: 1 }, r) : { delivered: 1, error: { name: 'TimeoutError', message: '„' + target.name + '“ hat nicht geantwortet.' } });
      });
    };
    if (wins.length || !a.open) { deliver(wins); return; }
    // Ziel ist zu: im Hintergrund öffnen und zustellen, sobald es bereit ist.
    var nw = WM.open(target.apps && target.apps.length ? Apps.get(target.id + '/' + target.apps[0].id) : target, { min: true, focus: false, newWindow: true });
    whenReady(nw, 10000).then(function () { deliver([nw]); });
  }
  function whenReady(w, ms) {
    return new Promise(function (res) {
      if (w.ready) { res(); return; }
      var off = null;
      var t = setTimeout(function () { if (off) off(); res(); }, ms);
      off = HX.on('ready', function (x) { if (x === w) { clearTimeout(t); off(); setTimeout(res, 50); } });
    });
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
      var iconsOn = HX.prefs.get('desktopIcons') !== false, sz = HX.prefs.get('iconSize') || 'mittel';
      HX.menu([
        { label: 'Desktop anpassen …', icon: 'sliders-horizontal', run: function () { shell.openApp('sys:settings', { page: 'desktop' }); } },
        { label: 'Hintergrund ändern', icon: 'image', run: function () { shell.openApp('sys:settings', { page: 'look' }); } },
        '-',
        { label: iconsOn ? 'Symbole ausblenden' : 'Symbole zeigen', icon: iconsOn ? 'eye-off' : 'eye', run: function () { HX.prefs.set('desktopIcons', !iconsOn); } },
        iconsOn ? { label: sz === 'gross' ? 'Kleinere Symbole' : 'Größere Symbole', icon: sz === 'gross' ? 'zoom-out' : 'zoom-in', run: function () { HX.prefs.set('iconSize', sz === 'klein' ? 'mittel' : sz === 'mittel' ? 'gross' : 'mittel'); } } : null,
        '-',
        { label: 'Dateien', icon: 'folder', run: function () { shell.openApp('sys:files'); } },
        { label: 'Desktop neu laden', icon: 'refresh-cw', run: reloadDesktop }
      ], { x: e.clientX, y: e.clientY });
    });
  }

  document.addEventListener('DOMContentLoaded', function () { wireSearch(); boot(); });
})();
