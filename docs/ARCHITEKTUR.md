# Architektur

## Überblick

```
┌───────────────────────────────────────────────┐
│  Browser (PWA)                                │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  views  │→ │  stores  │→ │   services   │  │
│  └─────────┘  └──────────┘  └──────┬───────┘  │
│                    ↓                │          │
│              src/shared (Regeln)    │ HTTP     │
└─────────────────────────────────────┼──────────┘
                                      ↓
┌───────────────────────────────────────────────┐
│  /api/* → api/handler.ts → server/router      │
│      ↓                                        │
│  server/routes  →  server/services            │
│                          ↓                    │
│                    server/store               │
│              PostgreSQL │ In-Memory           │
└───────────────────────────────────────────────┘
```

## Entscheidungen

### Vue 3 statt Migration auf Next.js

Der Bestand war ein sauberes Vue-3-/Vite-/TypeScript-Gerüst. Es trägt alle
Anforderungen: Routing, State, Animationen, PWA und ein Serverless-Backend über
`/api`. Ein Framework-Wechsel hätte die vorhandene Struktur ersetzt, ohne eine
einzige Anforderung besser zu erfüllen. Ergänzt wurden Vue Router, Pinia und
`vite-plugin-pwa`.

### Geteilte Domänenschicht

`src/shared/` enthält reine Funktionen ohne Browser- oder Node-Abhängigkeiten:
Namensvalidierung, Impostor-Regeln, Sitzordnung, Raumcodes. Client und Server
importieren dieselben Funktionen. Damit kann die Konfigurationsseite dieselbe
Prüfung anzeigen, die der Server verbindlich durchsetzt – ohne dass beide
Fassungen auseinanderlaufen.

### Ein Router für Dev und Produktion

`server/router.ts` arbeitet auf Node-`IncomingMessage`/`ServerResponse`.

- **Vercel** leitet jede Pfadtiefe unter `/api/*` per Rewrite auf die konkrete
  Function `api/handler.ts`; sie rekonstruiert den öffentlichen Pfad und ruft
  den Router auf. Ein Dateiname wie `[...path].ts` ist bei einer rohen
  Vite-Function kein verlässlicher rekursiver Catch-all.
- **Vite** mountet ihn über `server/dev/vitePlugin.ts` als Middleware.
- **Tests** starten den Function-Handler mit `node:http` auf einem freien Port
  und prüfen den Rewrite-Vertrag einschließlich tiefer Raumrouten.

Es gibt keinen zweiten Codepfad, der in Produktion abweichen könnte.

### Importe im Servergraph: explizite `.js`-Endungen

Vercel **bündelt die Function nicht**, sondern transpiliert jede TypeScript-Datei
einzeln und lässt die Import-Specifier unverändert. Ausgeführt wird das Ergebnis
als Node-ESM. Daraus folgen drei Regeln, die im gesamten Graphen aus `api/`,
`server/` und dem davon genutzten `src/shared/` gelten:

- Relative Importe brauchen eine explizite `.js`-Endung, auch wenn die Quelle
  eine `.ts`-Datei ist (`./errors` → `./errors.js`).
- Verzeichnis-Importe gibt es nicht; `../store` muss `../store/index.js` heißen.
- TypeScript-only-Aliase wie `@shared/*` existieren zur Laufzeit nicht und sind
  im Servergraph durch relative Pfade ersetzt. Im Frontend bleibt der Alias, weil
  Vite ihn auflöst.

Erzwungen wird das nicht durch Disziplin, sondern durch
`tsconfig.server.json` mit `moduleResolution: "nodenext"`: ein vergessener
Specifier ist dort ein Typfehler (TS2835) und fällt beim `npm run type-check`
auf, nicht erst im Deployment.

### Keine JSON-Importe im Servergraph

Aus demselben Grund liegen die Seed-Daten als TypeScript-Modul
(`src/data/impostorSeedPool.ts`) und nicht als JSON-Import vor. Vercel
kompiliert die Serverdateien in einen Output-Baum und emittiert dabei **keine
Nicht-TS-Dateien**; das File-Tracing findet eine importierte `.json` dort nicht
mehr, und die Function stirbt beim Modul-Laden mit
`FUNCTION_INVOCATION_FAILED`. Ein Import-Attribut hilft dagegen nicht – das
Problem ist nicht die Syntax, sondern die fehlende Datei.

`impostor-seed-pool.json` bleibt die redaktionelle Quelle und wird von
`npm run seeds:generate` in das Modul überführt. `src/data/seedPool.test.ts`
vergleicht beide und schlägt fehl, sobald sie auseinanderlaufen.

Nachprüfen lässt sich das ohne Deployment: `@vercel/nft` über den kompilierten
Entrypoint laufen lassen und schauen, ob eine Datei im Trace fehlt.

### Speicherabstraktion mit zwei Adaptern

`server/store/types.ts` beschreibt die Persistenz, `postgres.ts` und `memory.ts`
implementieren sie. Die **Spielregeln liegen ausschließlich** in
`server/services/roomService.ts` und arbeiten gegen die Transaktionsschnittstelle
`RoomTx`. Beide Adapter verhalten sich dadurch gleich, und die Regeln sind ohne
laufende Datenbank testbar.

Der In-Memory-Adapter ist keine Attrappe: Rejoin-Tokens, Rate-Limits und
Adminsitzungen verhalten sich exakt wie mit PostgreSQL. Es fehlt nur die
Persistenz – deshalb lehnt `assertProductionReady()` ihn in Produktion ab.

### Nebenläufigkeit

Jede Raumänderung läuft in einer Transaktion, die zuerst
`select … for update` auf der Raumzeile ausführt. Zwei gleichzeitige
Hostaktionen können sich damit nicht überholen. Jede Mutation erhöht
`rooms.version`; der Client übernimmt nur Antworten mit einer Version, die nicht
älter ist als sein aktueller Stand. Der In-Memory-Adapter serialisiert
Transaktionen über eine Promise-Kette – dieselbe Semantik.

Sitznummern haben eine `deferrable initially deferred` Unique-Bedingung, damit
mehrere Zeilen innerhalb einer Transaktion ihre Nummer tauschen können.

### Realtime als Polling

Vercels Serverless-Funktionen haben keine langlebigen Verbindungen. Statt eine
WebSocket-Architektur anzunehmen, die dort nicht funktioniert, synchronisiert
`RoomSyncService` per kurzem Polling:

- 2 s im Vordergrund, 10 s bei verstecktem Tab
- exponentielles Nachlassen bis 15 s bei Netzfehlern
- `visibilitychange` löst sofort eine Aktualisierung aus
- endgültige Fehler (403/404/410) beenden das Polling, statt endlos zu wiederholen

Ein Push-Adapter (Supabase Realtime, SSE, Pusher) kann dieselbe Schnittstelle
implementieren; Stores und Views bleiben unverändert.

### Serverseitige Filterung

`buildView()` in `roomService.ts` ist die einzige Stelle, die eine Raumsicht
erzeugt. Sie bekommt den Betrachter übergeben und setzt für dessen eigenen Platz
`term: null`. Der eigene Begriff wird also nicht ausgeblendet, sondern gar nicht
erst übertragen – auch nicht an den Host. Während der laufenden Runde wird
zusätzlich der selbst vergebene Begriff nicht mehr ausgeliefert, damit sich der
eigene nicht indirekt erschließen lässt.

Private Notizen werden nur für den anfragenden Spieler geladen und erhöhen die
Raumversion nicht – sie lösen bei niemandem sonst ein Update aus.

### Datensparsamkeit

- Analytics akzeptieren nur eine geschlossene Liste von Ereignisnamen und
  Payload-Feldern. Freitext, Namen und Begriffe werden serverseitig verworfen,
  selbst wenn ein manipulierter Client sie mitschickt.
- Geräte- und IP-Kennungen werden mit `SESSION_SECRET` gepfeffert gehasht.
- Wer-bin-ich-Begriffe und Notizen werden beim Rundenende gelöscht, spätestens
  mit dem Raum.
- Analytics werden **nie** automatisch gelöscht – nur manuell durch den Admin und
  nur mit ausdrücklicher Bestätigung.
- `room_events` protokolliert Ereignistypen, niemals Inhalte.

### Rate-Limits

Ein gleitendes Fenster über einzelne Treffer in `rate_limit_hits`. Zählen und
Eintragen laufen in einer Transaktion mit `pg_advisory_xact_lock`, damit zwei
parallele Anfragen das Limit nicht gemeinsam überschreiten. Vorschläge werden
doppelt begrenzt – über die anonyme Browserkennung *und* über einen gehashten
IP-Schlüssel –, sodass ein neuer Inkognito-Tab nichts bringt.

## Datenfluss: eine Wer-bin-ich-Runde

1. Host ruft `POST /api/rooms` auf, erhält Code, `playerId` und Rejoin-Token.
   Das Token wird lokal gespeichert; in der Datenbank liegt nur sein SHA-256-Hash.
2. Mitspieler treten über `POST /api/rooms/:code/join` bei – per Code oder über
   den QR-Deep-Link `/room/<code>`.
3. Jeder Spieler bekommt seinen Sitznachbarn im Kreis zugewiesen und gibt für ihn
   einen Begriff ein. Ändert sich die Sitzordnung, werden Zuweisungen verworfen,
   deren Ziel nicht mehr stimmt.
4. Der Host sieht ausschließlich „abgegeben / fehlt noch / offline“.
5. `POST /api/rooms/:code/start` prüft: mindestens drei Spieler, alle haben
   abgegeben. Erst danach werden Begriffe sichtbar.
6. Jeder Client pollt `GET /api/rooms/:code` und bekommt eine für ihn gefilterte
   Sicht.
7. `POST /api/rooms/:code/end` beendet die Runde, löscht Begriffe und Notizen der
   Runde und öffnet die Lobby für die nächste.

## Aufräumen

`server/services/maintenance.ts` läuft gedrosselt (höchstens alle fünf Minuten)
im Hintergrund regulärer Anfragen und

- löscht Lobbyräume nach einer Stunde Inaktivität (laufende Runden nie),
- entfernt Rate-Limit-Treffer älter als 24 Stunden,
- entfernt abgelaufene Adminsitzungen.

Für höhere Last lässt sich stattdessen ein Vercel-Cron auf
`POST /api/admin/maintenance` legen.

## Verzeichnisse

| Pfad | Inhalt |
| --- | --- |
| `src/shared/` | Regeln und Validierung, von Client und Server geteilt |
| `src/config/` | umgebungsabhängige Clientkonfiguration |
| `src/i18n/` | alle sichtbaren Texte, aktuell nur Deutsch |
| `src/styles/` | Design-Tokens und Basis-CSS |
| `src/services/` | Adapter: Storage, Haptik, Audio, HTTP, Analytics, Raum-Sync |
| `src/stores/` | Pinia-Stores |
| `src/components/` | wiederverwendbare UI-Bausteine |
| `src/views/` | Seiten je Route |
| `server/routes/` | HTTP-Schicht, nur Validierung und Übersetzung |
| `server/services/` | Spielregeln, Krypto, Adminauth, Analytics-Aggregation |
| `server/store/` | Persistenz: Schnittstelle plus zwei Adapter |
| `migrations/` | versionierte SQL-Migrationen mit Rollback |
| `scripts/` | Migration, Seed, Passwort-Hash |
