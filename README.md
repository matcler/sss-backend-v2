# sss-backend

Backend (Node.js + TypeScript) per il **Session State Service (SSS)**: event store + snapshot + API (Fastify) per orchestrare lo stato di sessione.

## Requisiti

- Node.js (LTS consigliato)
- Docker Desktop (per Postgres nei contract test)

## Setup

```powershell
cd C:\dev\sss-backend
npm ci
```

## Comandi utili

```powershell
# Dev server (ts-node-dev)
npm run dev

# Dev server + Postgres docker (container sss-postgres-test)
npm run dev:docker

# Test (Vitest)
npm test

# Build + start (dist/)
npm run build
npm start
```

## Postgres per i contract test

## Config DB in dev

- `DATABASE_URL`: se valorizzata viene usata sempre.
- Se `DATABASE_URL` non è valorizzata e `NODE_ENV !== production`, il backend usa di default:
  `postgres://postgres:postgres@127.0.0.1:5433/sss_test`
- In `production`, `DATABASE_URL` è obbligatoria.

All'avvio il server logga la connessione DB con password mascherata.

## DEV seed combat

Endpoint disponibile solo quando `NODE_ENV != production`:

- `POST /sessions/:id/dev/seed-combat`

Smoke manuale:

```bash
curl -sS -X POST http://127.0.0.1:3000/sessions -H "content-type: application/json" -d '{"ruleset":"5e"}'
# prendi session_id

curl -sS -X POST http://127.0.0.1:3000/sessions/<SID>/dev/seed-combat -H "content-type: application/json" -d '{}'

curl -sS http://127.0.0.1:3000/sessions/<SID>/state
```

I contract test Postgres **non creano schema via DDL**: assumono che lo schema esista già.  
Lo schema versionato è in: `sql/001_init.sql`.
“Versioning eventi: stream vuoto → currentVersion=0 → primo evento=1 (congelato)”

“expected_version si riferisce sempre alla stream version”

“meta.version riflette l’ultima event.version applicata”

### Avvio container (locale)

Esempio (Postgres 14 su porta 5433, DB `sss_test`):

```powershell
docker run --name sss-postgres-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sss_test `
  -p 5433:5432 -d postgres:14
```

Se il container esiste già:

```powershell
docker start sss-postgres-test
```

### Applicare lo schema (idempotente)

Usa lo script PowerShell:

```powershell
.\sql\apply.ps1 -ContainerName sss-postgres-test
```

Note:
- lo script applica `sql/001_init.sql` su `sss_test`
- è **idempotente** (safe to run più volte)
- richiede Docker avviato e container in stato **running**

### Se manca `apply.ps1`

Crea `sql/apply.ps1` e committalo nel repo. Lo script deve usare pipe (PowerShell) e non la redirezione `<`.

Riga chiave:

```powershell
Get-Content $resolvedSql | docker exec -i $ContainerName psql -U $DbUser -d $Database
```

## Running Postgres integration tests

I test Postgres sono **integration test** e di default vengono **skippati**.

Option A: Testcontainers (Postgres self-contained)

```bash
RUN_PG_TESTS_TC=true pnpm vitest tests/sss.postgres.repository.versioning.test.ts
```

Oppure via script:

```bash
npm run test:pg:tc
```

Option B: Docker Compose (Postgres esterno + healthcheck)

```bash
npm run pg:up
```

Imposta le variabili:

```
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=postgres
export PGDATABASE=sss_test
```

Poi:

```bash
RUN_PG_TESTS=true pnpm vitest tests/sss.postgres.repository.versioning.test.ts
```

Oppure via script:

```bash
npm run test:pg
```

Nota: i test standard (`npm test`) non richiedono Postgres.

## Note progetto

- Repo locale (Windows/PowerShell): `C:\dev\sss-backend`
- Workflow git: evitare `git pull` di default; chiedere conferma prima di ogni `git push`.

## Versioning eventi (CONGELATO)

- Stream vuoto → `currentVersion = 0`
- Primo evento persistito → `version = 1`
- `expected_version` **si riferisce sempre alla stream version**
- `meta.version` riflette **l’ultima `event.version` applicata**

Questa convenzione è **congelata** per evitare ambiguità e regressioni.
Un eventuale passaggio a versioning 0-based richiederà una milestone dedicata.
