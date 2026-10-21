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

  var SUITES = [
    { role: 'aura', name: 'Aura360', about: 'Dein Tag, deine Ziele, dein Leben im Blick', glyph: 'sun-moon', colors: ['#F6C08C', '#B66A2C'] },
    { role: 'devworks', name: 'Devworks Studio', about: 'Apps bauen, testen und ausliefern', glyph: 'code', colors: ['#2DD4BF', '#0E6F66'] },
    { role: 'cockpit', name: 'Cockpit', about: 'Steuerzentrale für deine Projekte', glyph: 'activity', colors: ['#7DA2FF', '#3550B8'] }
  ];

  var installed = [];
  var Apps = HX.apps = {
    system: SYSTEM,
    suites: SUITES,
    installed: function () { return installed; },
    all: function () { return SYSTEM.concat(installed); },
    get: function (id) {
      if (!id) return null;
      for (var i = 0; i < SYSTEM.length; i++) if (SYSTEM[i].id === id) return SYSTEM[i];
      for (var j = 0; j < installed.length; j++) if (installed[j].id === id) return installed[j];
      return null;
    },
    /** App für einen Verweis aus einer anderen App: id, Rolle („aura“) oder Manifest-id. */
    resolve: function (ref) {
      if (!ref) return null;
      ref = String(ref);
      var a = Apps.get(ref) || Apps.get('sys:' + ref);
      if (a) return a;
      var low = ref.toLowerCase();
      for (var i = 0; i < installed.length; i++) {
        var x = installed[i];
        if (x.role === low || (x.manifestId && x.manifestId.toLowerCase() === low) || x.name.toLowerCase() === low) return x;
      }
      return null;
    },
    byOrigin: function (origin) {
      for (var i = 0; i < installed.length; i++) if (installed[i].origin === origin) return installed[i];
      return null;
    },
    suite: function (role) {
      for (var i = 0; i < installed.length; i++) if (installed[i].role === role) return installed[i];
      return null;
    },
    refresh: function () {
      if (!HX.online) return Promise.resolve(installed);
      return HX.api('/api/apps').then(function (list) {
        installed = (list || []).map(function (a) {
          a.iconUrl = a.icon;
          return a;
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
        HX.emit('apps', installed);
        return installed;
      }).catch(function (e) {
        console.warn('[HX] apps', e);
        return installed;
      });
    },
    /** Adresse, unter der die App im Fenster startet. */
    urlFor: function (app, path) {
      if (app.system) {
        var u = new URL(app.path, location.href);
        if (path && typeof path === 'object') for (var k in path) if (path[k] != null) u.searchParams.set(k, path[k]);
        return u.href;
      }
      if (path && typeof path === 'string') {
        if (/^https?:/i.test(path)) return path;
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
          (a.roleLabel && a.roleLabel.toLowerCase().indexOf(q) >= 0);
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
