# Deployment freischalten

Stand: `amar-v1` ist gepusht, Vercel hat gebaut, das Deployment ist grün. Die
URL ist aber noch durch Deployment Protection abgeschirmt und läuft ohne
Datenbank. Diese vier Schritte machen die App öffentlich spielbar.

Preview-URL des Branches (bleibt über Deployments hinweg gleich):

```
https://rtgr-imposter-git-amar-v1-luismeinhardtwien-2884s-projects.vercel.app
```

---

## 1. Deployment Protection abschalten

*Project → Settings → Deployment Protection → Vercel Authentication*

Auf **Disabled** oder **Only Production** stellen und speichern. Wirkt sofort,
ohne Redeploy.

Prüfen – muss `200` liefern statt `302`:

```sh
curl -o /dev/null -w "%{http_code}\n" \
  https://rtgr-imposter-git-amar-v1-luismeinhardtwien-2884s-projects.vercel.app/api/health
```

Ab hier ist **Impostor** auf jedem Handy vollständig spielbar – der Wortpool mit
350 Begriffen ist im Bundle, es braucht dafür keine Datenbank.

---

## 2. Datenbank verbinden

„Wer bin ich?“ braucht zwingend PostgreSQL. Ohne `DATABASE_URL` läuft der Server
im In-Memory-Modus, und weil Serverless-Instanzen horizontal skalieren, landen
zwei Handys auf verschiedenen Instanzen und finden denselben Raum nicht.

*Project → Storage* – falls dort schon eine Postgres-Datenbank hängt, ist
`DATABASE_URL` beziehungsweise `POSTGRES_URL` eventuell nur für Production
freigegeben. Dann in *Settings → Environment Variables* zusätzlich das Häkchen
bei **Preview** setzen. Sonst eine neue Datenbank anlegen (Neon oder Vercel
Postgres) und den Connection String kopieren.

Danach lokal einmalig Schema und Startdaten einspielen:

```sh
export DATABASE_URL="postgres://…"
npm run db:migrate    # legt nur neue Tabellen an, ändert nichts Bestehendes
npm run db:seed       # 350 Begriffe, idempotent
npm run db:status     # zur Kontrolle
```

**Reihenfolge ist verpflichtend:** Migration `0002_whoami_round_rankings.sql`
muss vor dem Deployment dieser Serverversion als angewendet (`✔`) erscheinen.
Andernfalls verweigert `/api/health` den Bereitschaftsstatus; so kann ein Build
ohne Ranking-Tabelle nicht unbemerkt live gehen.

---

## 3. Umgebungsvariablen setzen

*Project → Settings → Environment Variables*, jeweils mit Häkchen bei
**Preview** (und **Production**, falls promoted wird):

| Variable | Wert |
| --- | --- |
| `DATABASE_URL` | Connection String aus Schritt 2 |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `ADMIN_USERNAME` | frei wählbar |
| `ADMIN_PASSWORD_HASH` | Ausgabe von `npm run admin:hash` |
| `VITE_PUBLIC_BASE_URL` | die Preview-URL von oben, **ohne** Schrägstrich am Ende |

Zwei Fallstricke:

- **`VITE_PUBLIC_BASE_URL` wird beim Build eingebacken.** Sie muss *vor* dem
  Redeploy stehen, sonst zeigen die QR-Codes auf die falsche Adresse.
- **Der Hash enthält `:` statt `$`.** Beim Kopieren nichts abschneiden – er ist
  eine einzelne lange Zeile.

`npm run admin:hash` fragt das Passwort interaktiv ab und gibt nur den Hash aus;
das Klartextpasswort verlässt deinen Rechner nicht.

---

## 4. Neu deployen und prüfen

Änderungen an Umgebungsvariablen greifen erst mit einem neuen Build:

*Deployments → beim obersten Eintrag auf ⋯ → Redeploy*

Danach prüfen:

```sh
BASE=https://rtgr-imposter-git-amar-v1-luismeinhardtwien-2884s-projects.vercel.app
curl -s $BASE/api/health          # {"ok":true,"store":"postgres", …}
curl -s $BASE/api/terms | head -c 120
curl -i $BASE/api/admin/session   # 401 als JSON aus der App, niemals Vercel-NOT_FOUND
```

Steht dort `"store":"memory"`, ist `DATABASE_URL` in der Preview-Umgebung noch
nicht gesetzt. Der Admin-Session-Aufruf prüft absichtlich einen tieferen
API-Pfad: So fällt ein defektes Vercel-Catch-all-Routing schon vor dem Spieltest
auf.

---

## Abnahme auf dem Handy

1. Preview-URL öffnen, 18+ bestätigen.
2. **Impostor** mit drei Namen durchspielen – Swipe-Aufdeckung, Timer, Aufdecken.
3. **Wer bin ich?**: auf einem Gerät Raum erstellen, mit drei weiteren Geräten
   oder Tabs über QR-Code beitreten, Begriffe eingeben, starten. Jeder muss bei
   sich selbst „find es raus du bot“ sehen. Danach auf mehreren Geräten
   „Erraten“ melden, als Host in unterschiedlicher Reihenfolge bestätigen und
   prüfen: lückenlose Plätze, automatischer letzter Platz und eine sauber
   nachrückende Rangfolge nach „Zurücknehmen“.
4. **PWA installieren**: iOS über Teilen → Zum Home-Bildschirm, Android über
   Menü → App installieren.
5. **`/admin`** aufrufen und anmelden.

---

## Production-Promote

Bewusst **nicht** ausgeführt: der Auftrag verbietet ihn ohne ausdrückliche
Anweisung. Wenn `amar-v1` die Hauptdomain übernehmen soll:

*Deployments → das gewünschte Deployment → ⋯ → Promote to Production*

Vorher dieselben Umgebungsvariablen auch für **Production** setzen. Ohne
`DATABASE_URL` verweigert der Server dort bewusst den Dienst, damit keine Räume
unbemerkt verschwinden.
