# Helix-Desktop

Der Desktop von **Helix 2**: eine Web-Oberfläche, die in der Helix-App (Android-WebView mit lokalem Server) läuft und in der deine Web-Apps als Fenster starten.

Ursprünglich ein Fork von [Ubuntu Tour](https://github.com/malisipi/ubuntu-tour) von malisipi. Aufbau und Bedienidee (Leiste oben, Dock, Übersicht, Fenster) stammen von dort; Code, Gestaltung und Apps sind für Helix neu geschrieben, das Ubuntu-Branding ist vollständig ersetzt.

## Was drin ist

- **Desktop-Ansicht** (ab 900 px Breite): Fenster ziehen, Größe ändern, an Ränder einrasten, maximieren; Dock links, Übersicht mit allen Fenstern, Starter mit Suche.
- **Handy-Ansicht**: Fenster füllen den Bildschirm, unten Start, Fenster und Apps; Startseite mit Uhr, den Suiten (Aura360, Devworks Studio, Cockpit) und deinen Apps.
- **System-Apps** (`apps/`): Dateien, App-Center (Installieren, Updates mit Vorschau, Sicherungen, Berechtigungen, Desktop-Update), Einstellungen, Editor, Vorschau, Terminal, Uhr, Hilfe.
- Fenster und Einstellungen überstehen Neustarts und Desktop-Updates (gespeichert über `/api/desktop/prefs`).

## Wie der Desktop mit Helix spricht

- Der Helix-Server fügt in jede HTML-Seite `window.Helix` ein. Der Desktop (`https://desktop.helix.local`) bekommt System-Rechte.
- Installierte Apps laufen in Fenstern auf eigenen Origins (`https://<id>.helix.local`) und schicken Nachrichten per `postMessage` (`{__helix: 1, op, args}`): `state`, `title`, `notify`, `open`, `open-url`, `pin`, `update`, `close`.
- Android ruft `window.__helixDesktop.emit(type, data)`, `.back()` und `.insets({top, bottom, left, right})` auf. Beim Start holt `POST /api/desktop/hello` die gesammelten Ereignisse ab.
- Die System-Apps teilen den Origin des Desktops und erreichen ihn über `parent.HX` (siehe `apps/lib/app.js`).

## Entwickeln

Im Repository [Helix-2](https://github.com/SoraSipsIcedTea/Helix-2) liegt unter `tools/devserver` ein Entwicklungsserver für den PC:

```
java -cp … app.kyst.helix2.dev.DevServer --desktop ../Helix-shell --data ./devdata --port 8711
```

Dann `http://desktop.localhost:8711/` öffnen. Änderungen an diesem Repository sind nach einem Neuladen sichtbar.

## Updates

`helix-app.json` enthält die Update-Adresse dieses Repositories. Im App-Center unter **Helix-Desktop** holt „Nach Update suchen“ den aktuellen Stand von `main`, zeigt die Änderungen und legt vorher eine Sicherung an. Die APK bringt beim Bauen ebenfalls den aktuellen Stand mit.

## Lizenzen

- Code: [Mozilla Public License 2.0](LICENSE.txt), wie Ubuntu Tour.
- Symbole: [Lucide](https://lucide.dev), ISC-Lizenz ([LICENSE_LUCIDE.txt](LICENSE_LUCIDE.txt)).
- Schrift: Poppins von Indian Type Foundry, SIL Open Font License 1.1 ([LICENSE_OFL.txt](LICENSE_OFL.txt)).
- Hintergrundbilder: für Helix erzeugt, gleiche Lizenz wie der Code.
