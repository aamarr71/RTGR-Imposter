# komm 10te

Mobile-first Partyspiel-Sammlung als installierbare PWA. Zwei vollständig
spielbare Modi:

- **Impostor** – ein Smartphone, das zur geheimen Rollenaufdeckung herumgereicht wird.
- **Wer bin ich?** – mehrere Smartphones, Raum per Code oder QR-Deep-Link.

Die Oberfläche ist vollständig deutsch, die App ist durchgehend 18+.

---

## Inhalt

- [Schnellstart](#schnellstart)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Datenbank und Migrationen](#datenbank-und-migrationen)
- [Seed-Import](#seed-import)
- [Admin-Ersteinrichtung](#admin-ersteinrichtung)
- [Tests](#tests)
- [Deployment auf Vercel](#deployment-auf-vercel)
- [PWA-Installation](#pwa-installation)
- [Architektur](#architektur)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)

---

## Schnellstart

```sh
npm install
npm run dev
```

Die App läuft danach auf <http://localhost:5173>. Der Vite-Dev-Server mountet die
API unter `/api` als Middleware – es ist **kein zweiter Server nötig**, und es ist
derselbe Code, den Vercel später als Serverless Function ausführt.

Ohne `DATABASE_URL` startet der Server mit einem flüchtigen In-Memory-Speicher:

| Bereich | ohne Datenbank | mit Datenbank |
| --- | --- | --- |
| Impostor | vollständig spielbar (gebündelter Wortpool) | zusätzlich Serverpool und Ziehungsstatistik |
| Wer bin ich | spielbar, Räume gehen beim Serverneustart verloren | dauerhaft, mehrere Instanzen |
| Wortvorschläge | funktionieren, sind aber flüchtig | dauerhaft in der Moderationswarteschlange |
| `/admin` | funktioniert, sobald die Zugangsdaten gesetzt sind | dito |

In Produktion (`VERCEL_ENV=production`) wird der Start ohne `DATABASE_URL`
bewusst abgelehnt, damit keine Räume unbemerkt verschwinden.

### Wichtige Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver inklusive API |
| `npm run build` | Typecheck und Produktionsbuild |
| `npm run preview` | Produktionsbuild lokal ausliefern (ohne API) |
| `npm run type-check` | `vue-tsc` über App, Node-Configs und Serverprojekt |
| `npm test` | gesamte Testsuite |
| `npm run db:migrate` | offene Migrationen anwenden |
| `npm run db:status` | anzeigen, welche Migrationen offen sind |
| `npm run db:rollback` | letzte Migration zurückrollen |
| `npm run db:seed` | die 350 Startbegriffe importieren |
| `npm run admin:hash` | `ADMIN_PASSWORD_HASH` erzeugen |

### Mit mehreren Geräten testen

„Wer bin ich?“ braucht mindestens drei Geräte oder Browser-Tabs. Im selben WLAN:

```sh
npm run dev -- --host
```

Vite zeigt dann eine Netzwerk-URL an, die auch das Smartphone erreicht. Für den
QR-Code sollte in diesem Fall `VITE_PUBLIC_BASE_URL` auf genau diese URL zeigen.

---

## Umgebungsvariablen

Vorlage: [`.env.example`](.env.example). `.env` steht in `.gitignore` – es sind
keine Secrets im Repository.

| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `DATABASE_URL` | in Produktion | PostgreSQL-Verbindung. `POSTGRES_URL` wird ebenfalls akzeptiert. |
| `DATABASE_SSL` | nein | `disable` für lokale Instanzen ohne TLS. Neon/Supabase/Vercel werden automatisch erkannt. |
| `ROOM_STORE` | nein | `postgres` oder `memory`, überschreibt die automatische Wahl. |
| `ADMIN_USERNAME` | für `/admin` | Benutzername des einzigen Admin-Accounts. |
| `ADMIN_PASSWORD_HASH` | für `/admin` | scrypt-Hash aus `npm run admin:hash`. |
| `SESSION_SECRET` | für `/admin` | Mindestens 32 Zeichen. Pfeffer für pseudonyme Hashes. |
| `VITE_PUBLIC_BASE_URL` | nein | Basis-URL für Deep Links und QR-Codes. Fällt sonst auf `window.location.origin` zurück. |
| `PUBLIC_BASE_URL` | nein | Serverseitiges Gegenstück. |

`VITE_`-Variablen landen im Browser-Bundle und dürfen deshalb **nur öffentliche
Werte** enthalten. Alle Secrets werden ausschließlich serverseitig gelesen.

---

## Datenbank und Migrationen

Die Migrationen liegen als nummerierte SQL-Dateien in [`migrations/`](migrations)
und werden von [`scripts/migrate.ts`](scripts/migrate.ts) angewendet. Angewendete
Migrationen stehen in `schema_migrations`, jede läuft in einer eigenen
Transaktion.

```sh
export DATABASE_URL="postgres://..."
npm run db:status     # was ist offen?
npm run db:migrate    # anwenden
```

`0001_init.sql` ist rein additiv: es werden ausschließlich neue Tabellen, Typen
und Indizes angelegt. Bestehende Tabellen werden weder verändert noch gelöscht.

### Angelegte Tabellen

| Tabelle | Inhalt |
| --- | --- |
| `categories` | die sieben Kategorien der ersten Version |
| `impostor_terms` | Wortpool inklusive Ziehungszähler und Reviewstatus |
| `term_suggestions` | Moderationswarteschlange der Nutzervorschläge |
| `rate_limit_hits` | gleitendes Fenster für serverseitige Rate-Limits |
| `rooms`, `room_players` | Wer-bin-ich-Räume und Sitzordnung |
| `whoami_assignments` | vergebene Begriffe je Runde |
| `whoami_round_progress` | offene Erraten-Meldungen und serverseitige Plätze der aktuellen Runde |
| `player_private_notes` | private Notizen, ausschließlich für den jeweiligen Spieler |
| `room_events` | Revisionsprotokoll des Raums, bewusst ohne Inhalte |
| `analytics_events`, `analytics_daily_aggregates` | anonyme Ereignisse und Aggregate |
| `admin_sessions`, `admin_audit_log` | Adminsitzungen (nur Token-Hashes) und Protokoll |

### Rollback und Wiederherstellung

Zu jeder Migration gehört eine `.down.sql`. **Vorher immer sichern:**

```sh
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d-%H%M).sql
npm run db:rollback
```

Ein Rollback von `0001_init` löscht sämtliche Daten dieser Migration,
einschließlich der Analytics. Wiederherstellung aus dem Dump:

```sh
psql "$DATABASE_URL" < backup-….sql
```

---

## Seed-Import

Der verbindliche Startbestand liegt als
[`src/data/impostor-seed-pool.json`](src/data/impostor-seed-pool.json):
**350 kuratierte Begriffe, exakt 50 pro Kategorie**, mit deutschem Jugend-Flair
über alle Kategorien verteilt.

```sh
npm run db:migrate
npm run db:seed
```

Der Import ist idempotent – ein zweiter Lauf ändert nichts. Duplikate werden über
`seed_id` und über die Kombination aus Anzeigebegriff und Kategorie erkannt. Die
Seeds sind für diese Entwicklungsfassung `enabled = true`, tragen aber
`review_status = needs_human_review`, damit sie im Adminbereich sichtbar bleiben.

Derselbe Bestand steckt im Browser-Bundle und dient als Offline-Fallback:
**Impostor ist ohne Internet und ohne Datenbank vollständig spielbar.**

Geladen wird zur Laufzeit allerdings nicht die JSON-Datei, sondern das daraus
erzeugte Modul [`src/data/impostorSeedPool.ts`](src/data/impostorSeedPool.ts).
Vercel emittiert beim Kompilieren der Serverdateien keine JSON-Dateien, ein
Laufzeit-Import wäre dort nicht auflösbar. Nach einer Änderung an der JSON also:

```sh
npm run seeds:generate
```

Wird das vergessen, schlägt `src/data/seedPool.test.ts` fehl.

Der Admin-Import (CSV oder JSON) legt Einträge dagegen immer **deaktiviert** und
als `needs_human_review` an – importierte Wörter erscheinen nie ungeprüft im Spiel.

---

## Admin-Ersteinrichtung

Es gibt keine öffentliche Registrierung und keine Standardzugangsdaten.

```sh
npm run admin:hash        # fragt das Passwort interaktiv ab
```

Ausgabe in die Umgebung übernehmen:

```sh
ADMIN_USERNAME=deinname
ADMIN_PASSWORD_HASH=scrypt$16384$8$1$…
SESSION_SECRET=$(openssl rand -base64 48)
```

Danach ist `/admin` erreichbar. Die Route wird in der normalen App bewusst nicht
verlinkt. Der Schutz liegt vollständig serverseitig: jede `/api/admin/*`-Route
prüft die Sitzung erneut, ein manipuliertes Frontend gewinnt nichts.

Sicherheitsmerkmale:

- Passwort nur als scrypt-Hash, Vergleich in konstanter Zeit
- Sitzungstoken zufällig und opak, in der Datenbank liegt nur der SHA-256-Hash
- HTTP-only-Cookie mit `SameSite=Strict`, `Secure` in Produktion
- Abmelden macht die Sitzung wirklich ungültig
- Anmeldeversuche sind serverseitig auf 10 pro Stunde und IP begrenzt
- alle Lösch- und Moderationsaktionen landen im `admin_audit_log`

---

## Tests

```sh
npm test
```

Zwei Projekte:

- **`unit`** (Node) – Validierung, Impostor-Regeln, Sitzordnung, Raumdienste und
  die komplette API über einen echten HTTP-Server.
- **`dom`** (jsdom) – die Swipe-Aufdeckung und der Impostor-Store, also die
  Stellen, an denen ein Fehler geheime Informationen preisgeben würde.

Abgedeckt sind unter anderem:

| Bereich | Beispiele |
| --- | --- |
| Impostor | 3–20 Spieler, doppelte Namen blockiert, ungültige Impostor-Anzahl blockiert, mindestens eine Kategorie, Hinweis an/aus, mehrere Impostor und gegenseitige Sichtbarkeit, Wiederholungen innerhalb der Sitzung, Timer startet erst beim Rundenstart, Timerzustand über Reload, Alarm deckt niemanden auf, Offline-Pool |
| Wer bin ich | Raum erstellen/beitreten, doppelte Namen, 3–20 Spieler, Reorder und korrekte Kreiszuweisung, Host sieht während des Ratens keine eigenen Begriffe, jeder bearbeitet nur seine Eingabe, vollständiges Podium deckt alle Begriffe auf, Notizen privat, Rejoin, kein Beitritt nach Start, Hostübergabe nach fünf Minuten, alter Host bekommt die Rechte nicht zurück, Raumlöschung nach einer Stunde, laufende Räume bleiben, Analytics überleben die Raumlöschung |
| Admin | unauthentifizierter Zugriff blockiert, Wort-CRUD, Moderationsworkflow, Rate-Limit 10/Stunde, Analytics-Zeiträume, Löschen nur mit Bestätigung, keine privaten Spielinhalte in Analytics |

Typecheck und Build gehören zur Abnahme:

```sh
npm run type-check
npm run build
```

---

## Deployment auf Vercel

> **Aktueller Stand:** `amar-v1` ist gepusht und gebaut, das Preview-Deployment
> ist grün. Es ist noch durch Deployment Protection abgeschirmt und läuft ohne
> Datenbank. Die vier Schritte zum Freischalten stehen in
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Konfiguration: [`vercel.json`](vercel.json). Framework `vite`, Ausgabe `dist`,
Serverless Function unter `api/handler.ts`. Ein expliziter Rewrite leitet jede
Pfadtiefe unter `/api/*` an diese Function weiter; der Handler stellt den
öffentlichen API-Pfad wieder her und delegiert an `server/router.ts`. Der
Rewrite `/((?!api/).*) → /index.html` ist der SPA-Fallback: Deep Links wie
`/room/K7M4PX` bekommen die App-Shell, `/api` bleibt bei der Function.

Das Vercel-Schema erlaubt in `rewrites` keine zusätzlichen Schlüssel – ein
`comment`-Feld lässt den Build ohne verwertbare Meldung scheitern.

### Preview-Deployment von `amar-v1`

```sh
git push origin amar-v1
```

Vercel erzeugt für jeden Push auf einen Nicht-Production-Branch automatisch ein
Preview-Deployment mit eigener URL. `main` bleibt davon unberührt – es gibt
keinen Production-Promote ohne ausdrückliche Freigabe.

Alternativ mit der CLI:

```sh
npx vercel            # Preview
npx vercel --prod     # nur nach ausdrücklicher Anweisung
```

### Environment-Variablen in Vercel

Unter *Project → Settings → Environment Variables* für **Preview** setzen:

`DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`,
optional `VITE_PUBLIC_BASE_URL`.

Für die Preview-Umgebung empfiehlt sich eine **eigene Datenbank** oder ein
eigenes Schema, damit Tests die Produktionsdaten nicht berühren. Nach dem
Anlegen einmalig:

```sh
DATABASE_URL="<preview-url>" npm run db:migrate
DATABASE_URL="<preview-url>" npm run db:seed
```

---

## PWA-Installation

Die App ist installierbar: Manifest, Icons (192/512/maskable), Theme Color,
Service Worker mit Offline-Fallback und Precaching der App-Shell.

**iOS (Safari):** Seite öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.
Voraussetzung ist HTTPS, also ein Deployment oder ein Tunnel – nicht `localhost`
auf einem anderen Gerät.

**Android (Chrome):** Seite öffnen → Menü → *App installieren* beziehungsweise
das eingeblendete Installationsbanner.

Offline verfügbar sind die App-Shell und der Impostor-Modus mit dem zuletzt
geladenen Wortpool. Fällt der Server aus, greift automatisch der lokale Cache
und die Konfigurationsseite weist sichtbar darauf hin. „Wer bin ich?“ braucht
naturgemäß eine Verbindung.

### Updates nach einem Deployment

Die App registriert neue Service Worker im Prompt-Modus und prüft beim Start,
bei Rückkehr in den Vordergrund sowie alle 15 Minuten im sichtbaren Zustand auf
einen neuen Build. Auf Home, in der Lobby und am vollständigen Podium wird er
sofort aktiviert und die App genau einmal neu geladen. Während einer laufenden
„Wer bin ich?“-Runde oder einer geschützten Impostor-Interaktion bleibt das
Update vorgemerkt; eine dezente Meldung erlaubt die bewusste sofortige
Aktualisierung, ansonsten folgt sie automatisch am nächsten sicheren Punkt.

Nur App-Shell und statische Build-Assets liegen im Precache. Multiplayer- und
Health-Endpunkte unter `/api/*` verwenden `NetworkOnly`; `/api/terms` bleibt die
bewusste `NetworkFirst`-Ausnahme für den Offline-Wortpool. Der laufende Build ist
unter Einstellungen als `package-version+commit` nachvollziehbar.

---

## Architektur

Ausführlich: [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md).
Native Portierung: [`docs/CAPACITOR.md`](docs/CAPACITOR.md).

Kurzfassung:

```
src/shared/     Spielregeln und Validierung – von Client und Server geteilt
src/services/   Adapter für Storage, Haptik, Audio, HTTP, Analytics, Raum-Sync
src/stores/     Pinia-Stores (Einstellungen, Impostor, Raum)
src/views/      Seiten je Route
server/         API-Router, Dienste, Speicheradapter (PostgreSQL + In-Memory)
api/            einziger Vercel-Einstiegspunkt, delegiert an server/router.ts
migrations/     versionierte SQL-Migrationen
```

**Framework:** Die vorhandene Vue-3-/Vite-/TypeScript-Struktur wurde
weiterentwickelt statt migriert. Sie trägt die Anforderungen vollständig, und ein
Wechsel auf Next.js hätte Aufwand ohne funktionalen Gewinn bedeutet. Ergänzt
wurden Vue Router, Pinia und `vite-plugin-pwa`.

**Realtime:** „Wer bin ich?“ nutzt kurzes Polling mit Versionsprüfung hinter dem
austauschbaren `RoomSyncService`. Vercels Serverless-Funktionen halten keine
langlebigen Verbindungen; eine WebSocket-Annahme wäre dort schlicht falsch. Das
Polling passt sein Intervall an (2 s aktiv, 10 s im Hintergrund, exponentiell
nachlassend bei Fehlern) und ist gegen einen Push-Adapter tauschbar, ohne dass
sich Views ändern.

**Sicherheit:** Sensible Raumansichten werden serverseitig gefiltert. Während
des Ratens wird der eigene Begriff bei „Wer bin ich?“ **gar nicht erst an den
eigenen Client gesendet** – auch nicht an den Host. Erst wenn alle Plätze
feststehen, deckt der gemeinsame Rundenabschluss alle Begriffe auf.
Rejoin-Tokens liegen nur gehasht in der Datenbank, der Raumcode allein genügt
nie als Authentifizierung.

---

## Bekannte Einschränkungen

- **Impressum und Datenschutz sind leere Platzhalter.** Es wurden bewusst keine
  Betreiber- oder Rechtsangaben erfunden. Vor einer Veröffentlichung müssen
  `src/views/legal/` und die Texte in `src/i18n/de.ts` befüllt werden.
- **Das Deployment läuft, ist aber noch nicht öffentlich.** Deployment
  Protection ist aktiv, und ohne `DATABASE_URL` nutzt die Preview den
  flüchtigen Speicher – Impostor funktioniert damit vollständig, „Wer bin ich?“
  nicht verlässlich, weil Serverless-Instanzen horizontal skalieren. Siehe
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- **Die Migrationen liefen noch gegen keine echte PostgreSQL-Instanz**, weil
  lokal keine verfügbar war. Sie sind gegen das Schema geschrieben und über den
  In-Memory-Adapter getestet.
- **Der In-Memory-Speicher ist kein Ersatz für eine Datenbank.** Er existiert für
  lokale Entwicklung und Tests und wird in Produktion abgelehnt.
- **QR-Scanner nur mit `BarcodeDetector`.** Chrome und Edge auf Android können
  scannen; iOS Safari unterstützt die API nicht und bekommt einen klaren Hinweis,
  den sechsstelligen Code einzutippen. Ein zusätzliches Decoder-Bundle wäre dafür
  unverhältnismäßig.
- **Aufräumarbeiten laufen huckepack auf Anfragen** (höchstens alle fünf
  Minuten), nicht als Cron-Job. Für hohe Last empfiehlt sich ein Vercel-Cron auf
  `POST /api/admin/maintenance`.
- **Sprache ist Deutsch.** Die Texte liegen zentral in `src/i18n/de.ts`; eine
  zweite Sprache ist ein weiteres Nachrichtenobjekt plus ein Eintrag in
  `src/i18n/index.ts`.
- **Kein Browser-E2E-Runner.** Die kritischen Flüsse sind über Integrationstests
  gegen den echten HTTP-Router und über Komponententests abgedeckt; ein
  zusätzlicher Browser-Runner wurde nicht ergänzt, um die Abhängigkeiten schlank
  zu halten.

---

## Arbeitsbranch

Entwickelt wird ausschließlich auf `amar-v1` in
`LuisVukcer71/RTGR-Imposter`. `main` und `luisV1` bleiben unverändert; ein Merge
nach `main` erfolgt nur nach ausdrücklicher Anweisung.
