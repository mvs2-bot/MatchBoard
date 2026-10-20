# 🏆 MatchBoard

**Stefan vs. Ines.** Gemeinsames Log aller Mini-Competitions: wer gewonnen hat, was gespielt wurde, wo und wann.

Wie bei Quest Log und TravelBase ist die Seite nur eine „leere Hülle“: Alle Matches liegen im gemeinsamen
Supabase-Core-Projekt (Tabellen `matchboard_*`) und werden erst nach dem Login geladen.
Ohne Anmeldung zeigt die Seite nur das Login-Formular.

## Aufbau

```
index.html               Login, Dashboard (Punktestand, Statistiken, Karte), Log mit Filtern, Dialog „＋ Match“
shared/style.css         Aussehen (gleiche Variablen und Bausteine wie Quest Log, Hell/Dunkel)
shared/config.js         Supabase-URL + Publishable Key (dürfen öffentlich sein)
shared/matchboard.js     Login, Daten laden/speichern, Offline-Zwischenspeicher, Profilbilder
```
