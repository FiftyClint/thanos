# Thanos Program

**Become Inevitable.**

A competition-prep training tracker: a 36-week periodized program across three
blocks, six training days a week, with set-by-set logging, smart weight
recommendations, weekly check-ins, progress photos, cardio and vacuum tracking,
and CSV/Excel export.

Installs to a phone home screen as a PWA and keeps working when the gym has no
signal.

---

## Quick start

### Docker (everything included)

```bash
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up --build
```

Open <http://localhost:5000> and register. The database is migrated and the
program content seeded automatically on first boot.

### Local development

Requires Node 20+ and a PostgreSQL 14+ you can reach.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET

npm run db:migrate            # create the schema
npm run db:seed               # load the program content
npm run dev                   # http://localhost:5000
```

`npm run dev` serves the API and the Vite client from one port, so there is no
CORS or proxy config to think about.

---

## Deploying

The app needs three things wherever it runs: a **Postgres database**, a **disk**
for progress photos, and an **HTTPS address** (an installed PWA won't work over
plain HTTP). Everything below is just those three things in different clothing.

### Railway

`railway.toml` is included, so Railway builds the Dockerfile and health-checks
the app without further configuration. The rest is dashboard clicks, once.

**1 — Create the project**

New Project → *Deploy from GitHub repo* → pick `thanos`. It will start building
immediately and **the first build will fail**. That's expected: there's no
database yet. Carry on.

**2 — Add the database**

In the project, *+ New* → *Database* → *Add PostgreSQL*. Railway names the
service `Postgres`.

**3 — Point the app at it**

Open the **thanos** service → *Variables* → *New Variable*, and add these. The
`${{...}}` is Railway's own syntax — paste it literally, it fills itself in:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | a long random string (see below) |
| `UPLOAD_DIR` | `/data` |
| `NODE_ENV` | `production` |

For `SESSION_SECRET`, any 32+ character random string works. On a Mac or Linux
terminal, `openssl rand -hex 32` prints one. A password manager's generator set
to 50 characters is equally fine. Keep it — changing it later logs you out.

**4 — Add the photo disk**

thanos service → *Settings* → *Volumes* → *Add Volume*, mount path `/data`.
Without this, photos vanish on every deploy.

**5 — Get your URL**

*Settings* → *Networking* → *Generate Domain*. That's the HTTPS address for your
phone. Open it, register your account.

**6 — Close the door**

Once your account exists, add one more variable so nobody else can sign up:

| Variable | Value |
| --- | --- |
| `ALLOW_REGISTRATION` | `false` |

If step 5 shows an SSL error in the logs, set `DATABASE_SSL` to `true` — that
happens when the database is reached over Railway's public proxy rather than its
private network.

### Fly.io

`fly.toml` is included.

```bash
fly launch --no-deploy --copy-config
fly postgres create --name thanos-db
fly postgres attach thanos-db                    # sets DATABASE_URL
fly volumes create thanos_data --size 3
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
fly secrets set ALLOW_REGISTRATION=false         # after your account exists
```

### Anywhere else

Render, a VPS with `docker compose`, a Synology — all fine. Provide
`DATABASE_URL` and `SESSION_SECRET`, mount a volume at `UPLOAD_DIR`, and point a
domain at port 5000.

If your host has no persistent disk, set `FILE_STORE=s3` and point it at any
S3-compatible bucket (Cloudflare R2, Backblaze B2, MinIO, AWS). See
`.env.example`.

### Installing on your phone

Visit the HTTPS URL, then **Share → Add to Home Screen** (iOS) or the install
prompt (Android). It runs fullscreen with no browser chrome, and keeps working
when the gym has no signal.

---

## Configuration

Every variable is validated at boot — the app refuses to start on bad config
rather than failing at the first request that needs it. Full list with comments
in [`.env.example`](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** |
| `SESSION_SECRET` | — | **Required in production**, 32+ chars. `openssl rand -hex 32` |
| `PORT` | `5000` | |
| `ALLOW_REGISTRATION` | `true` | Set `false` to close signups. The first account is always allowed. |
| `FILE_STORE` | `local` | `local` or `s3` |
| `UPLOAD_DIR` | `./data` | Photo volume root when `FILE_STORE=local` |
| `AUTO_MIGRATE` | `true` | Apply migrations on boot |
| `AUTO_SEED` | `true` | Sync program content on boot |
| `DATABASE_SSL` | `false` | `true` for Neon/Supabase/RDS |
| `NOTION_API_KEY` | — | Unset disables the Notion mirror entirely |

---

## How it works

```
client/          React 18 + Vite + Tailwind + shadcn/ui, dark theme
  src/pages/       one file per screen
  src/lib/         query client, offline queue
server/
  routes/          one router per resource
  lib/             pure domain logic — phases, progression, CSV
  files/           photo storage: local disk or S3
  seed/            the program content itself, one file per block
shared/schema.ts   Drizzle tables + Zod request schemas, used by both sides
migrations/        generated SQL, checked in
tests/             unit + API integration
```

### The training program

Three blocks live in `server/seed/`, as plain data:

| Block | Exercises | Focus |
| --- | --- | --- |
| Phase 1 — Base | 117 | 6-day split |
| Phase 2 — Build | 66 (+ shared warm-ups/cool-downs) | push/pull/legs |
| Phase 3 — Cut | 129 | 6-day specialization |

Each exercise is keyed by `(program, day, order, number)`. Editing a row updates
that exercise **in place**, so the sets you have already logged against it stay
attached. Adding a row inserts it; deleting one removes it *and its logged sets*.

Check what a content edit would do before running it:

```bash
npm run db:seed:dry     # reports  +inserted  ~updated  -removed
npm run db:seed
```

### Weight recommendations

Before you touch a weight box, the app fills it in, in this order of precedence:

1. **Deload week** (4, 8, 16, 24, 32) — hold the weight, drop a set or two.
2. **Accepted increase** — you approved a recommendation; apply it.
3. **Pending increase** — hold until you approve it.
4. **Auto-reduce** — two sessions short of the rep-range minimum, so back off one increment.
5. **Last session** — repeat what you did, matched per set and per side.

Unilateral work tracks left and right separately. Bands, timed holds, and cardio
get no suggestion, because there is no load to suggest.

After a session, each exercise is judged: top of the rep range with reps in
reserve earns a load increase; failure before the target reps raises a form
check. `server/lib/progressionAnalysis.ts` holds the rules, as pure functions.

### Offline

Gyms are basements. Writes go into IndexedDB first and replay when the
connection returns — a workout survives no signal, a closed tab, or the app
being killed mid-save. A banner shows what is still waiting to upload.

The endpoints the queue targets are idempotent by design: re-submitting a
workout replaces that day's sets rather than appending a second copy, and a
check-in updates that week's row. A replay after an uncertain failure cannot
double-log a session.

Photos still need a connection. Log a check-in offline and it saves your
measurements, then tells you to re-add the photos once you are back online.

---

## Development

```bash
npm run dev            # API + client with HMR
npm run check          # TypeScript
npm run lint
npm test               # unit tests; API tests need TEST_DATABASE_URL
npm run build          # client → dist/public, server → dist/index.js
npm start              # run the production build

npm run db:generate    # after editing shared/schema.ts
npm run db:migrate
npm run db:studio      # browse the database
```

### Tests

Unit tests (program rules, progression, CSV, seed integrity) run with no setup.
The API suite drives the real Express app over HTTP against a real Postgres —
migrations, constraints, sessions and all — and skips itself when no database
is configured:

```bash
createdb thanos_test
TEST_DATABASE_URL=postgres://localhost:5432/thanos_test npm test
```

CI runs typecheck, lint, the full suite against a Postgres service, the
production build, a Docker build, and a check that `shared/schema.ts` has not
drifted from `migrations/`.

### Changing the program

1. Edit the relevant file in `server/seed/`.
2. `npm run db:seed:dry` — confirm the `-removed` column is what you expect.
3. `npm run db:seed`.

`tests/seed.test.ts` guards the content: duplicate keys, unknown segments,
orphaned superset halves, and warm-ups ordered after working sets all fail the
build rather than reaching the database.

---

## What changed from the Replit version

Same app, same screens, same program data — rebuilt to run anywhere and to stop
losing things.

**No longer tied to Replit.** The Replit object-storage sidecar, Vite plugins,
and `.replit` workflow config are gone. The production build script the old
`package.json` referenced (`script/build.ts`) did not exist in the repo at all —
the production build only ever worked inside Replit's own image. There is now a
real one, plus a Dockerfile, compose file, and `fly.toml`.

**Bugs fixed:**

- **CSV export corrupted its own columns.** Rows were built by string
  concatenation with no escaping, so any exercise name or note containing a
  comma — which is most of them — silently shifted every later column. Now
  RFC 4180, with formula injection neutralised.
- **Unbounded query loop.** The vacuum streak ran one database query per day
  walked backwards, forever, and each one loaded the user's entire vacuum
  history to filter it in JavaScript. Now a single ranged query.
- **N+1 on history and export.** Every workout triggered its own query for its
  sets. Now one batched query.
- **Cardio and vacuum bodies went in unvalidated**, straight from `req.body`, so
  a missing duration reached Postgres as `NaN`.
- **Anyone could delete anyone's sessions.** Delete and recommendation-update
  endpoints checked the id but never the owner.
- **Progress photos were public** to anyone with the URL.
- **A duplicate workout save appended a second set of sets** instead of
  replacing the first.
- **Two type errors** that had never been caught, including the Phase 3 program
  export button, because `tsc` never ran in CI.

**Security:**

- `SESSION_SECRET` is required in production. It used to fall back to a
  hardcoded string committed to the repo, which let anyone forge a session.
- Rate limiting on login and registration — previously unlimited.
- Session id regenerated on login; passwords hashed at cost 12; login timing
  equalised so it does not reveal which emails are registered.
- Helmet CSP, and an explicit same-origin check on writes.
- Every request body validated with Zod; ownership checked on every record.
- **Request logging no longer dumps response bodies** — it used to write
  password hashes, session ids, and every measurement into the logs.
- Notion database ids moved out of the source and into config; the mirror is off
  unless a key is set.

**Data safety:**

- Checked-in SQL migrations instead of `drizzle-kit push`, which diffs against
  the live database and infers what to do — where a rename reads as "drop the
  column".
- The seeder is now deterministic. The old one decided whether to re-seed by
  hunting for "sentinel" exercise names a previous bad deploy might have left
  behind, and shipped a separate `fixProductionData.ts` that hand-repaired a
  corrupted production database on every boot. Both are gone: the seed files are
  the source of truth, and the sync is idempotent.
- Unique constraints on the things that should have been unique all along —
  one workout per day/week, one check-in per week, one exercise per program key.
- Graceful shutdown, so a deploy cannot cut a workout save in half.

**Performance:**

- Initial download roughly halved. `index.html` was loading **25 Google Font
  families** on every visit, of which the theme used two; those two are now
  self-hosted, so they also work offline and satisfy the CSP. Charting
  (~390 kB) moved behind a lazy route.
- Indexes on the columns the app actually queries.

**Added:** the offline write queue, 118 tests, CI, structured logging, a health
check, an error boundary, S3 support, and configurable registration.

---

## Licence

MIT
