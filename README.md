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
- Responsive Oberfläche ohne Build-Schritt

## Starten

Das Spiel ist eine statische Web-App. Ein lokaler Server reicht aus:

```powershell
cd "C:\Users\erich\Documents\Codex\Vier Gewinnt"
python -m http.server 4173 --bind 127.0.0.1
```

Danach im Browser öffnen:

```text
http://127.0.0.1:4173
```

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

Die Engine basiert auf `cf-engine.js` aus dem Connect-Four-Projekt von `eb58` und wurde für die UI-Anbindung angepasst.

## Projektstruktur

```text
.
├── index.html      # App-Struktur
├── styles.css      # Oberfläche und Layout
├── app.js          # UI-Logik und Engine-Anbindung
├── cf-engine.js    # Vier-Gewinnt-Engine
├── favicon.svg     # App-Icon
└── README.md
```

## Nächste Ideen

- Engine in einen Web Worker verschieben
- Zeitkontrolle innerhalb der Suche verbessern
- Bewertungsfunktion für nicht-terminale Stellungen ergänzen
- GitHub Pages Deployment einrichten
