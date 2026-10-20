# 🏆 MatchBoard

**Stefan vs. Ines.** Gemeinsames Log aller Mini-Competitions: wer gewonnen hat, was gespielt wurde, wo und wann.

Wie bei Quest Log und TravelBase ist die Seite nur eine „leere Hülle“: Alle Matches liegen im gemeinsamen
Supabase-Core-Projekt (Tabellen `matchboard_*`) und werden erst nach dem Login geladen.
Ohne Login gibt es einen **Demo-Modus** mit den zwölf Matches vom Sommer 2026 (nur im Browser, speichert nichts).

## Aufbau

```
index.html               Login, Dashboard (Punktestand, Statistiken, Karte), Log mit Filtern, Dialog „＋ Match“
shared/style.css         Aussehen (gleiche Variablen und Bausteine wie Quest Log, Hell/Dunkel)
shared/config.js         Supabase-URL + Publishable Key (dürfen öffentlich sein)
shared/matchboard.js     Login, Daten laden/speichern, Offline-Zwischenspeicher, Demo-Daten
supabase/migrations/     Schema, RLS und Seed (gehört später ins Repo supabase-core)
```

## Funktionen

- **Dashboard**: Punktestand mit Siegquote, Führung, aktuelle und längste Siegesserie, Anzahl Spiele, Orte und Spieltage,
  Aufteilung nach Kategorie und nach Spiel, die letzten fünf Matches.
- **Karte** (Leaflet + Esri World Street Map): ein Punkt pro Ort, Zahl = Matches dort, Farbe = wer am Ort führt.
  Ein Klick zeigt alle Matches an diesem Ort.
- **Log**: alle Matches nach Tag gruppiert; Suche (Titel, Spiel, Ort, Notiz, Mitspieler) und Filter nach Kategorie,
  Gewinner, Ort und Jahr. Klick auf einen Eintrag öffnet ihn zum Bearbeiten.
- **＋ Match**: Titel, Spiel (Vorschläge aus bisherigen Spielen, Kategorie wird übernommen), Kategorie, Datum,
  Gewinner oder Unentschieden, Ort (bestehender Ort oder neuer Ort per Tipp auf die Karte bzw. „Mein Standort“),
  optional Ergebnis, weitere Mitspieler ohne Konto (z. B. Mohamed) und Notiz.

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `matchboard_categories` | Sport, Geschicklichkeit, Kartenspiele, Würfelspiele, Gesellschafts- & Brettspiele, Quiz & Wissen, Videospiele, Sonstiges (Emoji, Farbe, Reihenfolge) |
| `matchboard_locations` | Ort mit Anzeigename, Region und Koordinaten; mehrere Matches teilen sich einen Ort |
| `matchboard_matches` | Titel, Spiel (Disziplin für die Statistik), Kategorie, Datum, Ort, `outcome` (`win`/`draw`), `winner_id`, Ergebnis, Gäste, Notiz |

Die Datenbank prüft selbst: Gewinner muss ein MatchBoard-Spieler sein, ein Sieg hat immer einen Gewinner und ein
Unentschieden keinen, das Datum liegt nicht in der Zukunft, Anleger und Anlagezeit bleiben fest.

## Rollen

Zugang über `overall_app_access` (App `matchboard`), wie bei den anderen Apps:

- **Stefan (admin)**: alles lesen und bearbeiten, Kategorien pflegen, jedes Match und jeden Ort löschen.
- **Ines (member)**: alles lesen, Matches und Orte anlegen und bearbeiten, selbst angelegte Matches löschen.
- Beide sehen denselben Stand. Konten ohne MatchBoard-Zugang sehen nichts.
- Spieler sind nur Konten mit eigenem MatchBoard-Eintrag; globale Admins sehen die Daten, tauchen aber nicht im Punktestand auf.

## Einrichtung

1. `supabase/migrations/20261020090000_matchboard_core.sql` im SQL Editor des Core-Projekts ausführen
   (oder als Migration in `supabase-core` übernehmen). Das Skript legt die App an, gibt Stefan und Ines Zugang,
   erstellt Tabellen und Regeln und spielt die zwölf Matches ein, solange die Tabelle noch leer ist. Es ist wiederholbar.
2. GitHub Pages für dieses Repo einschalten (Branch `main`, Ordner `/`).
3. Optional unter Authentication → URL Configuration `https://mvs2-bot.github.io/MatchBoard/` als Redirect URL eintragen.

## Wichtig

- Niemals den `secret`/`service_role` Key in dieses Repo legen.
- Die Koordinaten im Seed zeigen auf den Ort bzw. die Ortsmitte und lassen sich in Supabase korrigieren.
