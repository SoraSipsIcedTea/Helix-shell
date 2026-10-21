/* Helix-Desktop: App-Verzeichnis – System-Apps des Desktops und die installierten Apps vom Server. */
(function () {
  'use strict';
  var HX = window.HX;

  var SYSTEM = [
    { id: 'sys:files', name: 'Dateien', glyph: 'folder', colors: ['#2DD4BF', '#0E6F66'], path: 'apps/files/', about: 'Ordner, Speicher und verbundene Ordner', size: [920, 600] },
    { id: 'sys:appcenter', name: 'App-Center', glyph: 'package', colors: ['#F6C08C', '#B66A2C'], path: 'apps/appcenter/', about: 'Apps installieren, aktualisieren und verwalten', size: [900, 640], single: true },
    { id: 'sys:settings', name: 'Einstellungen', glyph: 'settings', colors: ['#8CA0C8', '#3B4A72'], path: 'apps/settings/', about: 'Darstellung, Speicher, Ablagen, System', size: [860, 620], single: true },
    { id: 'sys:editor', name: 'Editor', glyph: 'pencil', colors: ['#7DA2FF', '#3550B8'], path: 'apps/editor/', about: 'Textdateien bearbeiten', size: [860, 600], opens: 'text' },
    { id: 'sys:viewer', name: 'Vorschau', glyph: 'image', colors: ['#C79BFF', '#6C3FB8'], path: 'apps/viewer/', about: 'Bilder, Musik, Videos und PDFs ansehen', size: [860, 620], opens: 'media' },
    { id: 'sys:terminal', name: 'Terminal', glyph: 'square-terminal', colors: ['#3A4566', '#151B33'], path: 'apps/terminal/', about: 'Helix-Befehle und Konsolen-Ausgaben', size: [780, 480] },
    { id: 'sys:clock', name: 'Uhr', glyph: 'alarm-clock', colors: ['#FF9AAE', '#B23B5A'], path: 'apps/clock/', about: 'Weltzeit, Stoppuhr und Timer', size: [520, 560], single: true },
    { id: 'sys:help', name: 'Hilfe', glyph: 'circle-help', colors: ['#9BE37D', '#3E8A2B'], path: 'apps/help/', about: 'So funktioniert Helix', size: [760, 600], single: true }
  ];
  SYSTEM.forEach(function (a) { a.system = true; });

  /*
   * Installierte Pakete kommen vom Server. Ein Paket ist entweder eine App oder eine Suite:
   * eine Suite (helix-app.json „apps“) zeigt jede ihrer Apps einzeln – als Eintrag mit der id
   * „<paket>/<app>“, gleichem Origin und damit gemeinsamem Speicher. Keine Suite ist besonders.
   */
  var packages = [];
  var items = [];

  function expand(pkg) {
    pkg.iconUrl = pkg.icon;
    if (!pkg.apps || !pkg.apps.length) return [pkg];
    return pkg.apps.map(function (s) {
      return {
        id: pkg.id + '/' + s.id, name: s.name, about: s.description || '', url: s.url, path: s.path,
        origin: pkg.origin, iconUrl: s.icon || pkg.icon, pkg: pkg, sub: s, suite: pkg.name,
        shortcuts: [], version: pkg.version
      };
    });
  }
  function dirOf(path) { return '/' + String(path || '').replace(/[?#].*$/, '').replace(/[^/]*$/, ''); }

  var Apps = HX.apps = {
    system: SYSTEM,
    /** Alles, was man starten kann: einzelne Apps und die Apps der Suiten. */
    installed: function () { return items; },
    packages: function () { return packages; },
    all: function () { return SYSTEM.concat(items); },
    get: function (id) {
      if (!id) return null;
      var i;
      for (i = 0; i < SYSTEM.length; i++) if (SYSTEM[i].id === id) return SYSTEM[i];
      for (i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      for (i = 0; i < packages.length; i++) if (packages[i].id === id) return packages[i];
      return null;
    },
    /** Verweis einer App auf eine andere: id, „suite/app“, Manifest-id, Name, Rolle oder App einer Suite. */
    resolve: function (ref) {
      if (!ref) return null;
      ref = String(ref);
      var a = Apps.get(ref) || Apps.get('sys:' + ref);
      if (a) return a;
      var low = ref.toLowerCase(), i;
      var slash = low.indexOf('/');
      if (slash > 0) {
        var p = Apps.resolve(low.slice(0, slash));
        if (p && p.apps) return Apps.get(p.id + '/' + low.slice(slash + 1));
        return null;
      }
      for (i = 0; i < packages.length; i++) {
        var x = packages[i];
        if ((x.manifestId && x.manifestId.toLowerCase() === low) || x.name.toLowerCase() === low || x.role === low) return x;
      }
      for (i = 0; i < items.length; i++) if (items[i].sub && (items[i].sub.id === low || items[i].name.toLowerCase() === low)) return items[i];
      return null;
    },
    byOrigin: function (origin) {
      for (var i = 0; i < packages.length; i++) if (packages[i].origin === origin) return packages[i];
      return null;
    },
    /** Zu welcher App gehört eine Adresse? Bei Suiten die App, in deren Ordner die Seite liegt. */
    forUrl: function (url) {
      var u;
      try { u = new URL(url); } catch (e) { return null; }
      var pkg = Apps.byOrigin(u.origin);
      if (!pkg) return null;
      var best = null, len = 0;
      items.forEach(function (it) {
        if (it.pkg !== pkg) return;
        var d = dirOf(it.path);
        if (u.pathname.indexOf(d) === 0 && d.length > len) { best = it; len = d.length; }
      });
      return best || pkg;
    },
    /** Gehört ein Fenster-Eintrag zu dieser App (auch: zur Suite)? */
    belongs: function (item, target) {
      return item === target || item.id === target.id || (item.pkg && item.pkg.id === target.id);
    },
    refresh: function () {
      if (!HX.online) return Promise.resolve(items);
      return HX.api('/api/apps').then(function (list) {
        packages = (list || []).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
        var next = [];
        packages.forEach(function (p) { next = next.concat(expand(p)); });
        // Offene Fenster behalten ihre Einträge (gleiche id) – nur die Daten frisch.
        items = next;
        HX.emit('apps', items);
        return items;
      }).catch(function (e) {
        console.warn('[HX] apps', e);
        return items;
      });
    },
    /** Adresse, unter der die App im Fenster startet. path: Seite relativ zur Paketwurzel, oder #… / ?… zur App. */
    urlFor: function (app, path) {
      if (app.system) {
        var u = new URL(app.path, location.href);
        if (path && typeof path === 'object') for (var k in path) if (path[k] != null) u.searchParams.set(k, path[k]);
        return u.href;
      }
      if (path && typeof path === 'string') {
        if (/^https?:/i.test(path)) return path;
        if (path.charAt(0) === '#' || path.charAt(0) === '?') return app.url.replace(path.charAt(0) === '#' ? /#.*$/ : /[?#].*$/, '') + path;
        return app.origin + '/' + path.replace(/^\/+/, '');
      }
      return app.url;
    },
    search: function (q) {
      q = (q || '').trim().toLowerCase();
      var list = Apps.all();
      if (!q) return list;
      return list.filter(function (a) {
        return a.name.toLowerCase().indexOf(q) >= 0 || (a.about && a.about.toLowerCase().indexOf(q) >= 0) ||
          (a.suite && a.suite.toLowerCase().indexOf(q) >= 0);
      });
    }
  };

  /** Welche System-App öffnet eine Datei? */
  var TEXT = /\.(txt|md|markdown|json|js|mjs|cjs|ts|css|html?|xml|svg|csv|tsv|ini|conf|cfg|toml|ya?ml|log|sh|py|java|kt|c|h|cpp|go|rs|sql|gradle|properties|env|gitignore)$/i;
  var MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|ico|mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov|mkv|pdf)$/i;
  var PACKAGE = /\.(zip|helix|lwav)$/i;
  Apps.handlerFor = function (name) {
    if (PACKAGE.test(name)) return 'sys:appcenter';
    if (MEDIA.test(name)) return 'sys:viewer';
    if (TEXT.test(name) || name.indexOf('.') < 0) return 'sys:editor';
    return null;
  };
  Apps.isText = function (name) { return TEXT.test(name); };
  Apps.isMedia = function (name) { return MEDIA.test(name); };
})();
