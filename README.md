# Vier Gewinnt Pro

Eine browserbasierte Vier-Gewinnt-Variante mit polierter Oberfläche, starker KI und klassischer 7x6-Spielmechanik.

## Direkt spielen

Das Spiel läuft über GitHub Pages:

https://eb58.github.io/vier-gewinnt/

## Features

- Spiel gegen eine KI mit mehreren Schwierigkeitsstufen
- Direkter Klick auf eine Brettspalte zum Setzen eines Steins
- Tipp-Funktion für den nächsten Zug
- Zug zurücknehmen
- KI kann optional beginnen
- Punkteanzeige, Zugzähler und Engine-Statistiken
- KI-Suche in einem Web Worker, damit die Oberfläche bei hohen Suchtiefen bedienbar bleibt
- Responsive Oberfläche ohne Build-Schritt

## Starten

Das Spiel ist eine statische Web-App. Ein direkter Doppelklick auf `index.html`
funktioniert nicht, weil `app.js` als ES-Modul geladen wird – es braucht `http://`.
Ein beliebiger lokaler Static-Server reicht:

- **VS Code:** Rechtsklick auf `index.html` -> „Open with Live Server“
- **Node:** `npx serve -l 4173`

Danach im Browser öffnen (Port ggf. anpassen):

```text
http://127.0.0.1:4173
```

## Tests

Abhängigkeiten installieren und die Engine-Tests ausführen:

```bash
npm install
npm test
```

Für die Entwicklung können die Tests im Watch-Modus laufen:

```bash
npm run test:watch
```

Die Playwright-Regressionstests laufen headless in einer lokalen Chrome-Installation
und prüfen die Oberfläche in Desktop- und Mobilgröße:

```bash
npm run test:ui
```

Alle Unit- und UI-Tests gemeinsam:

```bash
npm run test:all
```

Zum visuellen Nachvollziehen kann Chrome sichtbar gestartet werden:

```bash
npm run test:ui:headed
```

`npm install` aktiviert außerdem den versionierten Pre-Commit-Hook. Vor jedem
Commit führt er `npm run test:all` aus und bricht den Commit ab, falls ein Unit-
oder UI-Test fehlschlägt.

## Stellung analysieren

Eine Stellung lässt sich auch direkt in der Konsole untersuchen. Die Argumente
sind Zugfolge, maximale Suchtiefe und maximale Denkzeit in Millisekunden:

```bash
npm run analyze -- 14141 6 1000
```

Die Zugfolge verwendet die Spaltennummern `1` bis `7`.

## Steuerung

- Maus: auf eine Spalte im Brett klicken
- Tastatur: `1` bis `7` für die Spalten
- `N`: neue Runde
- `Tipp`: KI-Vorschlag anzeigen
- `Zurück`: letzten Zug zurücknehmen

## KI-Stufen

| Stufe | Maximale Suchtiefe |
| --- | ---: |
| Locker | 8 |
| Club | 13 |
| Profi | 18 |
| Meister | 23 |

Die produktive Engine unter `engines/cf-engine.js` basiert auf dem Connect-Four-Projekt von `eb58` und wurde für die UI-Anbindung angepasst.

## Projektstruktur

```text
.
├── index.html      # App-Struktur
├── styles.css      # Oberfläche und Layout
├── app.js          # UI-Logik und Engine-Anbindung
├── engine-worker-client.js # Abbruch und Lebenszyklus der Worker-Suchen
├── engine-worker.js # Web Worker für KI-Suche
├── engines/
│   └── cf-engine.js # Vier-Gewinnt-Engine
├── favicon.svg     # App-Icon
├── run.js          # CLI zur Analyse einer Stellung
├── playwright.config.js # Headless-UI-Testkonfiguration
├── tests/          # Engine-, Worker- und UI-Tests
├── data/           # Teststellungen
└── README.md
```

## Nächste Ideen

- Zeitkontrolle innerhalb der Suche verbessern
- Bewertungsfunktion für nicht-terminale Stellungen ergänzen
