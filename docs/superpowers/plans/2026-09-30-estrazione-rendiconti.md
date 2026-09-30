# Estrazione rendiconti PDF: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App CAP demo che carica un PDF di rendiconto, estrae con GPT-5.5 (SAP AI Core) una riga per polizza, la salva in SQLite e la mostra in una pagina UI5 con preview a sinistra e tabella a destra.

**Architecture:** Un solo modulo CAP Node.js. `POST /upload` (multer) coordina controllo duplicati per hash, estrazione PDF (testo, con fallback a immagini per le scansioni), chiamata al modello e salvataggio transazionale. L'OData espone `Documents`/`Policies` in sola lettura. La UI UI5 freestyle è servita come statico dallo stesso modulo.

**Tech Stack:** Node.js 24, `@sap/cds` 10 (già nel repo), `@cap-js/sqlite`, express 5, multer, mupdf (WASM, nessun binario nativo), `node:test`, UI5 da CDN.

**Spec:** `docs/superpowers/specs/2026-09-30-estrazione-rendiconti-design.md`

## Global Constraints

- Nessuna colonna né campo di "% di accuratezza", in DB e in UI.
- Campi estratti per riga: data effetto, contraente, numero polizza, premi, provvigioni, data incasso.
- `Documents`: `ID_OPERAZIONE` (UUID, chiave), `NOME_DOCUMENTO`, `HASH_SHA256` (univoco), `DATA_CARICAMENTO`.
- `Policies`: `ID`, `ID_OPERAZIONE`, `NOME_DOCUMENTO`, `DATA_EFFETTO`, `CONTRAENTE`, `NUMERO_POLIZZA`, `PREMI`, `PROVVIGIONI`, `DATA_INCASSO`.
- Date salvate `YYYY-MM-DD`; importi decimali (`5.725,73` → `5725.73`); valore assente = `NULL`, mai inventato.
- Duplicato (stesso SHA-256): `409` con messaggio "Documento già caricato il gg/mm/aaaa", nessuna chiamata al modello.
- Limite file 10 MB; solo PDF.
- Errori: AI Core non raggiungibile o risposta non valida = `502` senza salvataggio; nessuna riga trovata = `422` "Nessuna polizza trovata" senza salvataggio.
- Nessuna autenticazione. SQLite su file, una sola istanza su CF (`instances: 1`), memoria app 1 GB.
- Nessun segreto nel repo: `.env` ignorato, solo `.env.example` senza valori. `AI_API_URL`, `DEPLOYMENT_ID`, `RESOURCE_GROUP` da configurazione.
- Deployment AI Core: scenario `azure-openai`, modello GPT-5.5, resource group `default`.
- Il `cf deploy` lo esegue l'utente in BAS; il piano si ferma al push su GitHub.

## Deviazioni dalla spec (decise scrivendo il piano)

- **Niente `temperature`:** i modelli GPT-5 accettano solo il valore di default, quindi non si invia il parametro (la spec diceva "temperatura bassa").
- **Un solo modulo MTA** che serve anche la UI statica (nessun modulo UI separato, nessun approuter), coerente con l'assenza di autenticazione.
- **Output del modello:** `response_format: json_object` con oggetto `{"righe": [...]}` e validazione nostra, non JSON schema strict (da rivalutare al test reale, Task 8).

## Review Focus

Casi che la spec implica ma non descrive, più probabili per primi:

1. **PDF corrotto o protetto da password:** risposta `400` con messaggio chiaro, non `500` (Task 4 e 6).
2. **Importi come il modello li scrive:** stringhe italiane (`1.927,76`), numeri, negativi (storni) e `null`: il segno si conserva, niente `NaN` (Task 2).
3. **Stessa polizza due volte nello stesso documento** (in IBC VITA `773016-0001` compare in due righe): entrambe salvate, nessun vincolo di unicità su `NUMERO_POLIZZA` (Task 1 e 6).
4. **Due upload identici in parallelo:** il secondo non deve dare `500`, ma `409` (vincolo unique sull'hash, Task 6).
5. **Nome file con accenti o percorso** (`Rendiconto è.pdf`, `C:\x\y.pdf`): salvato come nome base corretto, senza mojibake (Task 6).

---

## File Structure

| File | Responsabilità |
|---|---|
| `package.json` | dipendenze, config CDS (`db` su SQLite file), script `start` e `test` |
| `.gitignore` | aggiunge `.env`, `*.db`, `test/fixtures/` |
| `.env.example` | variabili richieste, senza valori |
| `db/schema.cds` | entità `Documents`, `Policies` |
| `srv/service.cds` | servizio OData in sola lettura |
| `srv/server.js` | bootstrap: upload, statici, gestione errori, init DB |
| `srv/upload.js` | `createUploadHandler({ db, extract })` |
| `srv/lib/errors.js` | `HttpError` |
| `srv/lib/schema.js` | `parseDate`, `parseAmount`, `normalizeRows` |
| `srv/lib/config.js` | `loadConfig(env)` |
| `srv/lib/pdf.js` | `extractContent(buffer)` |
| `srv/lib/llm.js` | `createLlmClient({ config, fetchImpl })` |
| `app/webapp/index.html`, `Main.view.xml`, `Main.controller.js` | UI |
| `mta.yaml`, `readme.md` | deploy e documentazione |
| `test/**` | test `node:test` e helper |

---

### Task 1: Fondamenta, schema DB e servizio OData

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `.env.example`, `db/schema.cds`, `srv/service.cds`, `test/helpers/db.js`, `test/schema.test.js`

**Interfaces:**
- Produces: entità `itas.ecbrk.Documents`, `itas.ecbrk.Policies` (nomi esatti, usati dai task 6 e dal servizio OData); `memDb()` in `test/helpers/db.js` che restituisce un db SQLite in memoria con lo schema distribuito.

- [ ] **Step 1: Installare le dipendenze**

```bash
npm install @cap-js/sqlite multer mupdf
npm install --save-dev @sap/cds-dk
```

- [ ] **Step 2: Configurare `package.json`**

Sostituire `scripts` e aggiungere `cds` (mantenere `dependencies` come installate da npm):

```json
"scripts": {
  "start": "cds-serve",
  "watch": "cds watch",
  "test": "node --test"
},
"cds": {
  "requires": {
    "db": { "kind": "sqlite", "credentials": { "url": "db.sqlite" } }
  }
}
```

- [ ] **Step 3: Aggiornare `.gitignore`**

Aggiungere in fondo:

```
.env
*.db
db.sqlite*
test/fixtures/
```

(`*.sqlite` è già presente. `test/fixtures/` contiene i PDF di esempio con dati di clienti e non va su GitHub.)

- [ ] **Step 4: Creare `.env.example`**

```
AI_CORE_CLIENT_ID=
AI_CORE_CLIENT_SECRET=
AI_CORE_AUTH_URL=
AI_API_URL=
DEPLOYMENT_ID=
RESOURCE_GROUP=default
AI_API_VERSION=2024-12-01-preview
```

- [ ] **Step 5: Scrivere il test che fallisce**

`test/helpers/db.js`:

```js
const cds = require('@sap/cds')
const path = require('node:path')

async function memDb () {
  cds.env.requires.db = { kind: 'sqlite', impl: '@cap-js/sqlite', credentials: { url: ':memory:' } }
  const db = await cds.connect.to('db')
  await cds.deploy(path.join(__dirname, '../../db')).to(db)
  return db
}

module.exports = { memDb }
```

`test/schema.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const cds = require('@sap/cds')
const { memDb } = require('./helpers/db')

test('Documents e Policies si salvano e rileggono', async () => {
  const db = await memDb()
  const { INSERT, SELECT } = cds.ql
  const doc = { ID_OPERAZIONE: cds.utils.uuid(), NOME_DOCUMENTO: 'a.pdf', HASH_SHA256: 'h1' }
  await db.run(INSERT.into('itas.ecbrk.Documents').entries(doc))
  await db.run(INSERT.into('itas.ecbrk.Policies').entries([
    { ID_OPERAZIONE: doc.ID_OPERAZIONE, NOME_DOCUMENTO: 'a.pdf', NUMERO_POLIZZA: 'P1', PREMI: 10.5 },
    { ID_OPERAZIONE: doc.ID_OPERAZIONE, NOME_DOCUMENTO: 'a.pdf', NUMERO_POLIZZA: 'P1', PREMI: 20 }
  ]))
  const rows = await db.run(SELECT.from('itas.ecbrk.Policies'))
  assert.equal(rows.length, 2) // stessa polizza due volte: ammesso
  assert.equal(rows[0].DATA_EFFETTO, null)
})

test('HASH_SHA256 è univoco', async () => {
  const db = await memDb()
  const { INSERT } = cds.ql
  const mk = () => ({ ID_OPERAZIONE: cds.utils.uuid(), NOME_DOCUMENTO: 'a.pdf', HASH_SHA256: 'same' })
  await db.run(INSERT.into('itas.ecbrk.Documents').entries(mk()))
  await assert.rejects(db.run(INSERT.into('itas.ecbrk.Documents').entries(mk())))
})
```

- [ ] **Step 6: Eseguire e verificare che fallisca**

Run: `npm test`
Expected: FAIL (entità `itas.ecbrk.Documents` non trovata, `db/` non esiste).

- [ ] **Step 7: Creare lo schema**

`db/schema.cds`:

```cds
namespace itas.ecbrk;

@assert.unique: { hash: [HASH_SHA256] }
entity Documents {
  key ID_OPERAZIONE : UUID;
  NOME_DOCUMENTO    : String(255) not null;
  HASH_SHA256       : String(64) not null;
  DATA_CARICAMENTO  : Timestamp @cds.on.insert: $now;
}

entity Policies {
  key ID            : UUID;
  ID_OPERAZIONE     : UUID not null;
  NOME_DOCUMENTO    : String(255);
  DATA_EFFETTO      : Date;
  CONTRAENTE        : String(255);
  NUMERO_POLIZZA    : String(100);
  PREMI             : Decimal(15,2);
  PROVVIGIONI       : Decimal(15,2);
  DATA_INCASSO      : Date;
}
```

Nessun vincolo di unicità su `NUMERO_POLIZZA`: la stessa polizza può comparire più volte nello stesso documento. Il vincolo UNIQUE su `HASH_SHA256` deve essere un vero vincolo del database: lo verifica il secondo test.

- [ ] **Step 8: Creare il servizio OData**

`srv/service.cds`:

```cds
using itas.ecbrk as db from '../db/schema';

@path: '/odata/archivio'
service ArchivioService {
  @readonly entity Documents as projection on db.Documents;
  @readonly entity Policies  as projection on db.Policies;
}
```

- [ ] **Step 9: Eseguire i test**

Run: `npm test`
Expected: PASS (2 test).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example db srv test
git commit -m "feat: schema SQLite Documents/Policies e servizio OData"
```

---

### Task 2: Validazione e conversione dei dati del modello

**Files:**
- Create: `srv/lib/errors.js`, `srv/lib/schema.js`, `test/lib/schema.test.js`

**Interfaces:**
- Produces:
  - `HttpError(status: number, message: string, code?: string)` da `srv/lib/errors.js`, con proprietà `status`, `code`.
  - `parseDate(v): string|null` → `YYYY-MM-DD`.
  - `parseAmount(v): number|null`.
  - `normalizeRows(raw): Array<{ dataEffetto, contraente, numeroPolizza, premi, provvigioni, dataIncasso }>` con date ISO e importi numerici; lancia `HttpError(502)` se `raw.righe` non è un array.

- [ ] **Step 1: Scrivere i test che falliscono**

`test/lib/schema.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseDate, parseAmount, normalizeRows } = require('../../srv/lib/schema')

test('parseDate converte gg/mm/aaaa e rifiuta il resto', () => {
  assert.equal(parseDate('31/01/2026'), '2026-01-31')
  assert.equal(parseDate('1/7/2026'), '2026-07-01')
  assert.equal(parseDate('2026-07-01'), '2026-07-01')
  assert.equal(parseDate('31/02/2026'), null)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
  assert.equal(parseDate('ieri'), null)
})

test('parseAmount gestisce formati italiani, numeri, negativi e null', () => {
  assert.equal(parseAmount('5.725,73'), 5725.73)
  assert.equal(parseAmount('1.927,76'), 1927.76)
  assert.equal(parseAmount('0,00'), 0)
  assert.equal(parseAmount('51,66'), 51.66)
  assert.equal(parseAmount('-12,50'), -12.5)
  assert.equal(parseAmount('25.167,17'), 25167.17)
  assert.equal(parseAmount(5725.73), 5725.73)
  assert.equal(parseAmount('5725.73'), 5725.73)
  assert.equal(parseAmount('€ 1.000,00'), 1000)
  assert.equal(parseAmount(null), null)
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('n/d'), null)
})

test('normalizeRows converte, scarta righe vuote e tiene i duplicati', () => {
  const rows = normalizeRows({ righe: [
    { dataEffetto: '31/01/2026', contraente: ' ACME ', numeroPolizza: 'P1', premi: '1.000,00', provvigioni: '10,00', dataIncasso: '28/07/2026' },
    { dataEffetto: null, contraente: null, numeroPolizza: null, premi: null, provvigioni: null, dataIncasso: null },
    { numeroPolizza: 'P1', premi: 5 }
  ] })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { dataEffetto: '2026-01-31', contraente: 'ACME', numeroPolizza: 'P1', premi: 1000, provvigioni: 10, dataIncasso: '2026-07-28' })
  assert.equal(rows[1].contraente, null)
})

test('normalizeRows lancia 502 se manca righe', () => {
  assert.throws(() => normalizeRows({}), e => e.status === 502)
  assert.throws(() => normalizeRows(null), e => e.status === 502)
  assert.deepEqual(normalizeRows({ righe: [] }), [])
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `node --test test/lib/schema.test.js`
Expected: FAIL (`Cannot find module '../../srv/lib/schema'`).

- [ ] **Step 3: Implementare**

`srv/lib/errors.js`:

```js
class HttpError extends Error {
  constructor (status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
module.exports = { HttpError }
```

`srv/lib/schema.js`:

```js
const { HttpError } = require('./errors')

function parseDate (v) {
  if (v == null) return null
  const s = String(v).trim()
  let y, m, d
  let mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3] }
  else if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3] }
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseAmount (v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).replace(/[^\d,.\-]/g, '')
  if (!/\d/.test(s)) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const text = v => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function normalizeRows (raw) {
  if (!raw || !Array.isArray(raw.righe)) throw new HttpError(502, 'Risposta del modello non valida', 'BAD_MODEL_RESPONSE')
  return raw.righe
    .map(r => ({
      dataEffetto: parseDate(r && r.dataEffetto),
      contraente: text(r && r.contraente),
      numeroPolizza: text(r && r.numeroPolizza),
      premi: parseAmount(r && r.premi),
      provvigioni: parseAmount(r && r.provvigioni),
      dataIncasso: parseDate(r && r.dataIncasso)
    }))
    .filter(r => r.contraente || r.numeroPolizza)
}

module.exports = { parseDate, parseAmount, normalizeRows }
```

- [ ] **Step 4: Verificare che passino**

Run: `node --test test/lib/schema.test.js`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add srv/lib/errors.js srv/lib/schema.js test/lib/schema.test.js
git commit -m "feat: validazione e conversione di date e importi"
```

---

### Task 3: Configurazione AI Core

**Files:**
- Create: `srv/lib/config.js`, `test/lib/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env = process.env): { authUrl, clientId, clientSecret, apiUrl, deploymentId, resourceGroup, apiVersion }`. Legge prima le variabili `AI_CORE_*`/`AI_API_URL`, poi `VCAP_SERVICES.aicore[0].credentials` (`clientid`, `clientsecret`, `url`, `serviceurls.AI_API_URL`). `DEPLOYMENT_ID` è obbligatorio. Lancia `HttpError(500)` con il nome della variabile mancante.

- [ ] **Step 1: Scrivere i test che falliscono**

`test/lib/config.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig } = require('../../srv/lib/config')

test('legge dalle variabili d\'ambiente', () => {
  const c = loadConfig({
    AI_CORE_CLIENT_ID: 'id', AI_CORE_CLIENT_SECRET: 's', AI_CORE_AUTH_URL: 'https://auth',
    AI_API_URL: 'https://api', DEPLOYMENT_ID: 'd1'
  })
  assert.deepEqual(c, { authUrl: 'https://auth', clientId: 'id', clientSecret: 's', apiUrl: 'https://api', deploymentId: 'd1', resourceGroup: 'default', apiVersion: '2024-12-01-preview' })
})

test('legge dal binding VCAP_SERVICES', () => {
  const c = loadConfig({
    DEPLOYMENT_ID: 'd1', RESOURCE_GROUP: 'rg',
    VCAP_SERVICES: JSON.stringify({ aicore: [{ credentials: { clientid: 'id', clientsecret: 's', url: 'https://auth', serviceurls: { AI_API_URL: 'https://api' } } }] })
  })
  assert.equal(c.clientId, 'id')
  assert.equal(c.apiUrl, 'https://api')
  assert.equal(c.resourceGroup, 'rg')
})

test('segnala la variabile mancante', () => {
  assert.throws(() => loadConfig({ AI_CORE_CLIENT_ID: 'id' }), e => e.status === 500 && /DEPLOYMENT_ID|AI_CORE_CLIENT_SECRET/.test(e.message))
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `node --test test/lib/config.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementare**

`srv/lib/config.js`:

```js
const { HttpError } = require('./errors')

function loadConfig (env = process.env) {
  let creds = {}
  if (env.VCAP_SERVICES) {
    try { creds = (JSON.parse(env.VCAP_SERVICES).aicore || [])[0]?.credentials || {} } catch { creds = {} }
  }
  const cfg = {
    authUrl: env.AI_CORE_AUTH_URL || creds.url,
    clientId: env.AI_CORE_CLIENT_ID || creds.clientid,
    clientSecret: env.AI_CORE_CLIENT_SECRET || creds.clientsecret,
    apiUrl: env.AI_API_URL || creds.serviceurls?.AI_API_URL,
    deploymentId: env.DEPLOYMENT_ID,
    resourceGroup: env.RESOURCE_GROUP || 'default',
    apiVersion: env.AI_API_VERSION || '2024-12-01-preview'
  }
  const names = { authUrl: 'AI_CORE_AUTH_URL', clientId: 'AI_CORE_CLIENT_ID', clientSecret: 'AI_CORE_CLIENT_SECRET', apiUrl: 'AI_API_URL', deploymentId: 'DEPLOYMENT_ID' }
  for (const [k, name] of Object.entries(names)) {
    if (!cfg[k]) throw new HttpError(500, `Configurazione mancante: ${name}`, 'CONFIG')
  }
  return cfg
}

module.exports = { loadConfig }
```

- [ ] **Step 4: Verificare che passino**

Run: `node --test test/lib/config.test.js`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add srv/lib/config.js test/lib/config.test.js
git commit -m "feat: configurazione AI Core da env e VCAP_SERVICES"
```

---

### Task 4: Estrazione del contenuto dal PDF

**Files:**
- Create: `srv/lib/pdf.js`, `test/helpers/makePdf.js`, `test/lib/pdf.test.js`

**Interfaces:**
- Produces: `extractContent(buffer: Buffer): Promise<{ text: string, images: Buffer[] }>`. Se il testo trimmato è sotto `100 * numeroPagine` caratteri, `images` contiene le prime 10 pagine come PNG (scala 2) e `text` è `''`; altrimenti `images` è `[]`. Lancia `HttpError(400)` per PDF corrotto o protetto da password.
- Produces (test): `makePdf(text?: string): Buffer` in `test/helpers/makePdf.js` (PDF a una pagina; senza testo produce una pagina vuota).

Nota: `mupdf` è solo ESM e licenza AGPL (accettabile per una demo interna; da citare nel readme). Si importa con `import()` dinamico da CommonJS.

- [ ] **Step 1: Scrivere helper e test che falliscono**

`test/helpers/makePdf.js`:

```js
function makePdf (text) {
  const content = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : ''
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach(o => { out += `${String(o).padStart(10, '0')} 00000 n \n` })
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
module.exports = { makePdf }
```

`test/lib/pdf.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { extractContent } = require('../../srv/lib/pdf')
const { makePdf } = require('../helpers/makePdf')

const LONG = 'Rendiconto polizza 773016-0001 contraente ACME SRL premio 1.000,00 provvigioni 10,00 data incasso 28/07/2026 x'

test('PDF con testo sufficiente: restituisce il testo, nessuna immagine', async () => {
  const r = await extractContent(makePdf(LONG))
  assert.match(r.text, /773016-0001/)
  assert.deepEqual(r.images, [])
})

test('PDF senza testo (scansione): restituisce immagini PNG', async () => {
  const r = await extractContent(makePdf(''))
  assert.equal(r.text, '')
  assert.equal(r.images.length, 1)
  assert.deepEqual([...r.images[0].subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('PDF corrotto: 400', async () => {
  await assert.rejects(extractContent(Buffer.from('%PDF-1.4 non valido')), e => e.status === 400)
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `node --test test/lib/pdf.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementare**

`srv/lib/pdf.js`:

```js
const { HttpError } = require('./errors')

const MIN_CHARS_PER_PAGE = 100
const MAX_IMAGE_PAGES = 10

let mupdfPromise
const loadMupdf = () => (mupdfPromise ||= import('mupdf'))

async function extractContent (buffer) {
  const mupdf = await loadMupdf()
  let doc
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  } catch {
    throw new HttpError(400, 'Il file PDF è danneggiato o non leggibile', 'BAD_PDF')
  }
  if (doc.needsPassword()) throw new HttpError(400, 'Il PDF è protetto da password', 'BAD_PDF')

  const pages = doc.countPages()
  let text = ''
  for (let i = 0; i < pages; i++) {
    text += doc.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n'
  }
  if (text.trim().length >= MIN_CHARS_PER_PAGE * pages) return { text, images: [] }

  const images = []
  for (let i = 0; i < Math.min(pages, MAX_IMAGE_PAGES); i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true)
    images.push(Buffer.from(pix.asPNG()))
  }
  return { text: '', images }
}

module.exports = { extractContent }
```

- [ ] **Step 4: Verificare che passino**

Run: `node --test test/lib/pdf.test.js`
Expected: PASS (3 test). Se l'API di `mupdf` differisce (nomi dei metodi), correggere in base a `node_modules/mupdf/dist/mupdf.d.ts` senza cambiare l'interfaccia di `extractContent`.

- [ ] **Step 5: Commit**

```bash
git add srv/lib/pdf.js test/helpers/makePdf.js test/lib/pdf.test.js
git commit -m "feat: estrazione testo o immagini dal PDF"
```

---

### Task 5: Client AI Core (GPT-5.5)

**Files:**
- Create: `srv/lib/llm.js`, `test/lib/llm.test.js`

**Interfaces:**
- Consumes: `loadConfig()` (Task 3) restituisce l'oggetto `config`; `HttpError` (Task 2).
- Produces: `createLlmClient({ config, fetchImpl = fetch }): { extractPolicies({ text, images }): Promise<object> }`. Restituisce l'oggetto JSON del modello (`{ righe: [...] }`) non ancora normalizzato. Ogni errore di rete, HTTP non 2xx o JSON non valido diventa `HttpError(502)`. Il token OAuth è in cache fino a 60 secondi prima della scadenza.

- [ ] **Step 1: Scrivere i test che falliscono**

`test/lib/llm.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createLlmClient } = require('../../srv/lib/llm')

const config = { authUrl: 'https://auth', clientId: 'id', clientSecret: 's', apiUrl: 'https://api', deploymentId: 'd1', resourceGroup: 'default', apiVersion: 'v1' }

function fakeFetch (handlers) {
  const calls = []
  const f = async (url, opts) => {
    calls.push({ url: String(url), opts })
    const h = handlers.find(x => String(url).includes(x.match))
    return h.reply(url, opts)
  }
  f.calls = calls
  return f
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const auth = { match: '/oauth/token', reply: () => json(200, { access_token: 'tok', expires_in: 3600 }) }
const chat = content => ({ match: '/chat/completions', reply: () => json(200, { choices: [{ message: { content } }] }) })

test('invia il testo, usa il token e restituisce il JSON', async () => {
  const f = fakeFetch([auth, chat('{"righe":[{"numeroPolizza":"P1"}]}')])
  const r = await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'testo pdf', images: [] })
  assert.deepEqual(r, { righe: [{ numeroPolizza: 'P1' }] })
  const call = f.calls.find(c => c.url.includes('/chat/completions'))
  assert.equal(call.url, 'https://api/v2/inference/deployments/d1/chat/completions?api-version=v1')
  assert.equal(call.opts.headers.Authorization, 'Bearer tok')
  assert.equal(call.opts.headers['AI-Resource-Group'], 'default')
  const body = JSON.parse(call.opts.body)
  assert.equal(body.temperature, undefined)
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.match(body.messages.at(-1).content, /testo pdf/)
})

test('con immagini invia image_url base64', async () => {
  const f = fakeFetch([auth, chat('{"righe":[]}')])
  await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: '', images: [Buffer.from('png')] })
  const body = JSON.parse(f.calls.find(c => c.url.includes('/chat/completions')).opts.body)
  const part = body.messages.at(-1).content.find(p => p.type === 'image_url')
  assert.equal(part.image_url.url, 'data:image/png;base64,' + Buffer.from('png').toString('base64'))
})

test('accetta JSON dentro fence markdown', async () => {
  const f = fakeFetch([auth, chat('```json\n{"righe":[]}\n```')])
  const r = await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  assert.deepEqual(r, { righe: [] })
})

test('il token è in cache tra due chiamate', async () => {
  const f = fakeFetch([auth, chat('{"righe":[]}')])
  const c = createLlmClient({ config, fetchImpl: f })
  await c.extractPolicies({ text: 'a', images: [] })
  await c.extractPolicies({ text: 'b', images: [] })
  assert.equal(f.calls.filter(x => x.url.includes('/oauth/token')).length, 1)
})

test('HTTP non 2xx, JSON non valido e rete giù danno 502', async () => {
  const bad = fakeFetch([auth, { match: '/chat/completions', reply: () => json(500, {}) }])
  await assert.rejects(createLlmClient({ config, fetchImpl: bad }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
  const notJson = fakeFetch([auth, chat('ciao')])
  await assert.rejects(createLlmClient({ config, fetchImpl: notJson }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
  const down = async () => { throw new Error('ECONNREFUSED') }
  await assert.rejects(createLlmClient({ config, fetchImpl: down }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
})
```

- [ ] **Step 2: Verificare che falliscano**

Run: `node --test test/lib/llm.test.js`
Expected: FAIL (modulo mancante).

- [ ] **Step 3: Implementare**

`srv/lib/llm.js`:

```js
const { HttpError } = require('./errors')

const SYSTEM_PROMPT = `Sei un assistente che estrae dati da rendiconti provvigionali assicurativi italiani.
Il documento contiene una tabella con una riga per ogni polizza/titolo.
Rispondi SOLO con un oggetto JSON di questa forma:
{"righe":[{"dataEffetto":"gg/mm/aaaa","contraente":"...","numeroPolizza":"...","premi":"...","provvigioni":"...","dataIncasso":"gg/mm/aaaa"}]}

Regole:
- Una voce per ogni riga di polizza, nell'ordine del documento. Non includere righe di totale, saldo o riporto.
- dataEffetto: colonna "Data Effetto"; se assente usa "Dec.Rata".
- contraente: colonna "Cliente" oppure "Contraente".
- numeroPolizza: colonna "Nro Contratto" (se il valore è ripetuto dopo "||" tieni solo il primo) oppure "Polizza".
- premi: "Premio Lordo" oppure "Premi" della riga, non il totale.
- provvigioni: "Provvigioni Attive Totali" oppure "Provvigioni" della riga, prima della ritenuta, non il totale.
- dataIncasso: colonna "Data Incasso" / "Data incasso".
- Copia importi e date come sono scritti nel documento. Se un valore manca usa null. Non inventare valori.`

function parseModelJson (content) {
  const s = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(s) } catch { throw new HttpError(502, 'Risposta del modello non valida', 'BAD_MODEL_RESPONSE') }
}

function createLlmClient ({ config, fetchImpl = fetch }) {
  let token, tokenExp = 0

  async function getToken () {
    if (token && Date.now() < tokenExp) return token
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const res = await fetchImpl(`${config.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    })
    if (!res.ok) throw new Error(`token HTTP ${res.status}`)
    const body = await res.json()
    token = body.access_token
    tokenExp = Date.now() + (body.expires_in - 60) * 1000
    return token
  }

  async function extractPolicies ({ text, images }) {
    const userContent = images && images.length
      ? [{ type: 'text', text: 'Estrai le righe di polizza dalle pagine allegate.' },
         ...images.map(b => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from(b).toString('base64') } }))]
      : `Estrai le righe di polizza dal seguente testo del documento:\n\n${text}`
    let data
    try {
      const res = await fetchImpl(
        `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/chat/completions?api-version=${config.apiVersion}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await getToken()}`, 'AI-Resource-Group': config.resourceGroup, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
            response_format: { type: 'json_object' },
            max_completion_tokens: 16000
          })
        })
      if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${await res.text()}`)
      data = await res.json()
    } catch (err) {
      console.error('[llm]', err.message)
      throw new HttpError(502, 'Servizio di estrazione non disponibile', 'LLM_UNAVAILABLE')
    }
    return parseModelJson(data.choices?.[0]?.message?.content)
  }

  return { extractPolicies }
}

module.exports = { createLlmClient }
```

- [ ] **Step 4: Verificare che passino**

Run: `node --test test/lib/llm.test.js`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add srv/lib/llm.js test/lib/llm.test.js
git commit -m "feat: client AI Core per GPT-5.5 con cache del token"
```

---

### Task 6: Endpoint di upload, inizializzazione DB e server

**Files:**
- Create: `srv/upload.js`, `srv/server.js`, `srv/init-db.js`, `test/upload.test.js`
- Modify: `package.json` (script `start`), `test/helpers/db.js`, `test/schema.test.js`

**Interfaces:**
- Consumes: `normalizeRows`, `HttpError` (Task 2); `loadConfig` (Task 3); `extractContent` (Task 4); `createLlmClient` (Task 5); entità del Task 1; `memDb` (Task 1).
- Produces:
  - `createUploadHandler({ db, extract, maxBytes = 10 * 1024 * 1024 })`: handler Express `(req, res, next)`. `extract(buffer: Buffer): Promise<object>` restituisce il JSON grezzo del modello (`{ righe: [...] }`). Risposta `201` `{ idOperazione, nomeDocumento, righe }`; gli errori passano a `next(err)`.
  - `errorHandler(err, req, res, next)`: `HttpError` diventa risposta con il suo `status` e `{ error: { code, message } }`; ogni altro errore diventa `500` con messaggio generico, dettaglio solo nel log.
  - `POST /upload` (campo multipart `file`) e UI statica da `app/webapp`.

- [ ] **Step 1: Correggere `memDb` perché restituisca un db pulito a ogni chiamata**

Sostituire `test/helpers/db.js` con:

```js
const cds = require('@sap/cds')
const path = require('node:path')

async function memDb () {
  if (cds.db) { await cds.db.disconnect(); delete cds.services.db; delete cds.db }
  cds.env.requires.db = { kind: 'sqlite', impl: '@cap-js/sqlite', credentials: { url: ':memory:' } }
  const db = await cds.connect.to('db')
  await cds.deploy(path.join(__dirname, '../../db')).to(db)
  return db
}

module.exports = { memDb }
```

Aggiungere in fondo a `test/schema.test.js`:

```js
test('ogni chiamata di memDb restituisce un db pulito', async () => {
  const { INSERT, SELECT } = cds.ql
  const a = await memDb()
  await a.run(INSERT.into('itas.ecbrk.Documents').entries({ ID_OPERAZIONE: cds.utils.uuid(), NOME_DOCUMENTO: 'x.pdf', HASH_SHA256: 'h-reset' }))
  const b = await memDb()
  assert.equal((await b.run(SELECT.from('itas.ecbrk.Documents'))).length, 0)
})
```

Run: `npm test`
Expected: PASS (tutti i test esistenti più questo). Se fallisce, sistemare `memDb` finché ogni chiamata dà un db vuoto: il Task 6 lo richiede.

- [ ] **Step 2: Scrivere i test dell'endpoint che falliscono**

`test/upload.test.js`:

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const cds = require('@sap/cds')
const { memDb } = require('./helpers/db')
const { makePdf } = require('./helpers/makePdf')
const { createUploadHandler, errorHandler } = require('../srv/upload')
const { HttpError } = require('../srv/lib/errors')

const ROWS = { righe: [
  { dataEffetto: '31/01/2026', contraente: 'ACME', numeroPolizza: 'P1', premi: '1.000,00', provvigioni: '10,00', dataIncasso: '28/07/2026' },
  { dataEffetto: '01/02/2026', contraente: 'ACME', numeroPolizza: 'P1', premi: '-5,00', provvigioni: null, dataIncasso: null }
] }

async function start ({ extract, maxBytes } = {}) {
  const db = await memDb()
  const calls = { n: 0 }
  const ex = extract || (async () => ROWS)
  const app = express()
  app.post('/upload', createUploadHandler({ db, extract: async b => { calls.n++; return ex(b) }, maxBytes }))
  app.use(errorHandler)
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const url = `http://127.0.0.1:${server.address().port}/upload`
  const post = (buf, name = 'a.pdf') => {
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), name)
    return fetch(url, { method: 'POST', body: fd })
  }
  const count = async e => (await db.run(cds.ql.SELECT.from(e))).length
  return { db, calls, post, url, count, close: () => server.close() }
}

test('upload valido: 201, righe salvate con id_operazione e nome documento', async () => {
  const t = await start()
  const res = await t.post(makePdf('uno'), 'rendiconto.pdf')
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.nomeDocumento, 'rendiconto.pdf')
  assert.equal(body.righe.length, 2)
  assert.equal(body.righe[0].premi, 1000)
  assert.equal(body.righe[1].premi, -5)
  const pol = await t.db.run(cds.ql.SELECT.from('itas.ecbrk.Policies'))
  assert.equal(pol.length, 2) // stessa polizza P1 due volte: entrambe salvate
  assert.ok(pol.every(p => p.ID_OPERAZIONE === body.idOperazione && p.NOME_DOCUMENTO === 'rendiconto.pdf'))
  t.close()
})

test('duplicato: 409, messaggio con data, modello non chiamato di nuovo', async () => {
  const t = await start()
  const pdf = makePdf('due')
  assert.equal((await t.post(pdf, 'a.pdf')).status, 201)
  const res = await t.post(pdf, 'rinominato.pdf')
  assert.equal(res.status, 409)
  assert.match((await res.json()).error.message, /già caricato il \d{2}\/\d{2}\/\d{4}/)
  assert.equal(t.calls.n, 1)
  assert.equal(await t.count('itas.ecbrk.Documents'), 1)
  t.close()
})

test('due upload identici in parallelo: uno 201 e uno 409', async () => {
  const t = await start({ extract: async () => { await new Promise(r => setTimeout(r, 50)); return ROWS } })
  const pdf = makePdf('tre')
  const res = await Promise.all([t.post(pdf), t.post(pdf)])
  assert.deepEqual(res.map(r => r.status).sort(), [201, 409])
  assert.equal(await t.count('itas.ecbrk.Documents'), 1)
  t.close()
})

test('file non PDF, file mancante e file troppo grande', async () => {
  const t = await start({ maxBytes: 200 })
  const notPdf = await t.post(Buffer.from('ciao'), 'x.pdf')
  assert.equal(notPdf.status, 400)
  const empty = await fetch(t.url, { method: 'POST', body: new FormData() })
  assert.equal(empty.status, 400)
  const big = await t.post(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500)]))
  assert.equal(big.status, 413)
  assert.equal(t.calls.n, 0)
  t.close()
})

test('nessuna polizza trovata: 422 e nulla salvato', async () => {
  const t = await start({ extract: async () => ({ righe: [] }) })
  const res = await t.post(makePdf('quattro'))
  assert.equal(res.status, 422)
  assert.equal((await res.json()).error.message, 'Nessuna polizza trovata')
  assert.equal(await t.count('itas.ecbrk.Documents'), 0)
  t.close()
})

test('errore 502 dal modello: nulla salvato; errore generico: 500 senza dettagli', async () => {
  const t = await start({ extract: async () => { throw new HttpError(502, 'Servizio di estrazione non disponibile') } })
  assert.equal((await t.post(makePdf('cinque'))).status, 502)
  assert.equal(await t.count('itas.ecbrk.Documents'), 0)
  t.close()
  const t2 = await start({ extract: async () => { throw new Error('segreto interno') } })
  const res = await t2.post(makePdf('sei'))
  assert.equal(res.status, 500)
  assert.doesNotMatch(JSON.stringify(await res.json()), /segreto/)
  t2.close()
})

test('nome file con accenti o percorso: salvato come nome base corretto', async () => {
  const t = await start()
  const a = await (await t.post(makePdf('sette'), 'Rendiconto è.pdf')).json()
  assert.equal(a.nomeDocumento, 'Rendiconto è.pdf')
  const b = await (await t.post(makePdf('otto'), 'C:\\x\\y.pdf')).json()
  assert.equal(b.nomeDocumento, 'y.pdf')
  t.close()
})
```

- [ ] **Step 3: Verificare che falliscano**

Run: `node --test test/upload.test.js`
Expected: FAIL (`Cannot find module '../srv/upload'`).

- [ ] **Step 4: Implementare `srv/upload.js`**

```js
const crypto = require('node:crypto')
const multer = require('multer')
const cds = require('@sap/cds')
const { HttpError } = require('./lib/errors')
const { normalizeRows } = require('./lib/schema')

const DOC = 'itas.ecbrk.Documents'
const POL = 'itas.ecbrk.Policies'

// busboy legge il nome file come latin1: si ricodifica in utf8 se il risultato è valido
function cleanName (original) {
  let n = String(original || 'documento.pdf')
  const recoded = Buffer.from(n, 'latin1').toString('utf8')
  if (!recoded.includes('\uFFFD')) n = recoded
  n = n.split(/[\\/]/).pop().trim()
  return (n || 'documento.pdf').slice(0, 255)
}

const fmtDate = ts => {
  const d = ts ? new Date(ts) : new Date()
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}
const duplicate = doc => new HttpError(409, `Documento già caricato il ${fmtDate(doc && doc.DATA_CARICAMENTO)}`, 'DUPLICATE')

function createUploadHandler ({ db, extract, maxBytes = 10 * 1024 * 1024 }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file')
  const { SELECT, INSERT } = cds.ql
  const findByHash = hash => db.run(SELECT.one.from(DOC).columns('DATA_CARICAMENTO').where({ HASH_SHA256: hash }))

  return (req, res, next) => {
    upload(req, res, async err => {
      try {
        if (err) {
          throw err.code === 'LIMIT_FILE_SIZE'
            ? new HttpError(413, 'File troppo grande (massimo 10 MB)', 'TOO_LARGE')
            : new HttpError(400, 'Upload non valido', 'BAD_UPLOAD')
        }
        const file = req.file
        if (!file) throw new HttpError(400, 'Nessun file ricevuto', 'NO_FILE')
        if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Il file non è un PDF', 'NOT_PDF')

        const nome = cleanName(file.originalname)
        const hash = crypto.createHash('sha256').update(file.buffer).digest('hex')

        const existing = await findByHash(hash)
        if (existing) throw duplicate(existing)

        const righe = normalizeRows(await extract(file.buffer))
        if (!righe.length) throw new HttpError(422, 'Nessuna polizza trovata', 'NO_ROWS')

        const id = cds.utils.uuid()
        try {
          await db.tx(async tx => {
            await tx.run(INSERT.into(DOC).entries({ ID_OPERAZIONE: id, NOME_DOCUMENTO: nome, HASH_SHA256: hash }))
            await tx.run(INSERT.into(POL).entries(righe.map(r => ({
              ID_OPERAZIONE: id, NOME_DOCUMENTO: nome,
              DATA_EFFETTO: r.dataEffetto, CONTRAENTE: r.contraente, NUMERO_POLIZZA: r.numeroPolizza,
              PREMI: r.premi, PROVVIGIONI: r.provvigioni, DATA_INCASSO: r.dataIncasso
            }))))
          })
        } catch (e) {
          if (/UNIQUE/i.test(e.message)) throw duplicate(await findByHash(hash))
          throw e
        }
        res.status(201).json({ idOperazione: id, nomeDocumento: nome, righe })
      } catch (e) { next(e) }
    })
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler (err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } })
  console.error('[upload]', err)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Errore interno durante l\'elaborazione' } })
}

module.exports = { createUploadHandler, errorHandler }
```

- [ ] **Step 5: Verificare che passino**

Run: `node --test test/upload.test.js`
Expected: PASS (7 test). Se fallisce il test sui nomi con accenti, regolare `cleanName` finché passa sia "Rendiconto è.pdf" sia "C:\x\y.pdf". Se il test del parallelo dà `500`, il messaggio del vincolo UNIQUE del driver SQLite non contiene "UNIQUE": adeguare il controllo nel `catch` al messaggio reale.

- [ ] **Step 6: Creare `srv/init-db.js`**

```js
// Crea il file SQLite con lo schema se non esiste (su CF il filesystem è effimero: riparte vuoto a ogni restart)
const fs = require('node:fs')
const cds = require('@sap/cds')

async function main () {
  const file = cds.env.requires.db.credentials.url
  if (fs.existsSync(file)) return
  const db = await cds.connect.to('db')
  await cds.deploy('*').to(db)
  await db.disconnect()
  console.log(`[init-db] creato ${file}`)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 7: Creare `srv/server.js`**

```js
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const cds = require('@sap/cds')
const { createUploadHandler, errorHandler } = require('./upload')
const { loadConfig } = require('./lib/config')
const { createLlmClient } = require('./lib/llm')
const { extractContent } = require('./lib/pdf')

if (fs.existsSync('.env')) process.loadEnvFile('.env')

let llm
const extract = async buffer => {
  const content = await extractContent(buffer)
  llm ||= createLlmClient({ config: loadConfig() })
  return llm.extractPolicies(content)
}

cds.on('bootstrap', app => {
  app.post('/upload', (req, res, next) => createUploadHandler({ db: cds.db, extract })(req, res, next))
  app.use('/', express.static(path.join(__dirname, '../app/webapp')))
  app.use(errorHandler)
})

module.exports = cds.server
```

- [ ] **Step 8: Aggiornare lo script `start` in `package.json`**

```json
"start": "node srv/init-db.js && cds-serve",
```

- [ ] **Step 9: Verificare l'avvio e il DB**

Run: `npm start` (in background), poi:

```bash
curl -s http://localhost:4004/odata/archivio/Documents
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('db.sqlite');console.log(d.prepare(\"select name from sqlite_master where type='table'\").all())"
```

Expected: la prima risposta è JSON con `value: []`; la seconda elenca le tabelle `itas_ecbrk_Documents` e `itas_ecbrk_Policies`. Poi fermare il server. Se `cds.deploy('*')` non crea le tabelle, usare `cds.deploy(cds.root)` oppure `cds deploy --to sqlite:db.sqlite` con `@sap/cds-dk`.

- [ ] **Step 10: Eseguire tutta la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add srv test package.json
git commit -m "feat: endpoint /upload con controllo duplicati, server e init DB"
```

---

### Task 7: Interfaccia UI5

**Files:**
- Create: `app/webapp/index.html`, `app/webapp/init.js`, `app/webapp/Main.view.xml`, `app/webapp/Main.controller.js`

**Interfaces:**
- Consumes: `POST /upload` con campo `file` → `201 { idOperazione, nomeDocumento, righe: [{ dataEffetto, contraente, numeroPolizza, premi, provvigioni, dataIncasso }] }`; errori `{ error: { code, message } }` con `409` per i duplicati.
- Produces: pagina servita su `/` (index.html).

- [ ] **Step 1: Creare `app/webapp/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rendiconti provvigionali</title>
  <script id="sap-ui-bootstrap"
    src="https://ui5.sap.com/resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-libs="sap.m,sap.ui.layout"
    data-sap-ui-compat-version="edge"
    data-sap-ui-async="true"
    data-sap-ui-resource-roots='{"itas.ecbrk": "./"}'
    data-sap-ui-on-init="module:itas/ecbrk/init"></script>
</head>
<body class="sapUiBody" id="content"></body>
</html>
```

- [ ] **Step 2: Creare `app/webapp/init.js`**

```js
sap.ui.define(["sap/ui/core/mvc/XMLView"], function (XMLView) {
  "use strict";
  XMLView.create({ viewName: "itas.ecbrk.Main" }).then(function (view) {
    view.placeAt("content");
  });
});
```

- [ ] **Step 3: Creare `app/webapp/Main.view.xml`**

```xml
<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m" xmlns:l="sap.ui.layout" xmlns:core="sap.ui.core"
  controllerName="itas.ecbrk.Main" height="100%">
  <Page title="Rendiconti provvigionali" enableScrolling="false" class="sapUiNoContentPadding">
    <headerContent>
      <Text text="{/fileName}" class="sapUiSmallMarginEnd"/>
      <Button text="Carica documento" icon="sap-icon://upload" type="Emphasized"
        enabled="{= !${/busy}}" press=".onPickFile"/>
    </headerContent>
    <content>
      <l:Splitter height="100%">
        <core:HTML content="&lt;iframe id='pdfPreview' style='width:100%;height:100%;border:0'&gt;&lt;/iframe&gt;">
          <core:layoutData><l:SplitterLayoutData size="50%"/></core:layoutData>
        </core:HTML>
        <ScrollContainer height="100%" vertical="true">
          <layoutData><l:SplitterLayoutData size="auto"/></layoutData>
          <Title text="Campi estratti ({/count})" class="sapUiSmallMargin"/>
          <Table items="{/rows}" busy="{/busy}" busyIndicatorDelay="0" noDataText="{/emptyText}">
            <columns>
              <Column><Text text="Data effetto"/></Column>
              <Column><Text text="Contraente"/></Column>
              <Column><Text text="Numero polizza"/></Column>
              <Column hAlign="End"><Text text="Premi"/></Column>
              <Column hAlign="End"><Text text="Provvigioni"/></Column>
              <Column><Text text="Data incasso"/></Column>
            </columns>
            <items>
              <ColumnListItem>
                <Text text="{path: 'dataEffetto', formatter: '.formatDate'}"/>
                <Text text="{contraente}"/>
                <Text text="{numeroPolizza}"/>
                <Text text="{path: 'premi', formatter: '.formatAmount'}"/>
                <Text text="{path: 'provvigioni', formatter: '.formatAmount'}"/>
                <Text text="{path: 'dataIncasso', formatter: '.formatDate'}"/>
              </ColumnListItem>
            </items>
          </Table>
        </ScrollContainer>
      </l:Splitter>
    </content>
  </Page>
</mvc:View>
```

- [ ] **Step 4: Creare `app/webapp/Main.controller.js`**

```js
sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageBox) {
  "use strict";

  const EMPTY = "Carica un documento PDF";
  const amount = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

  return Controller.extend("itas.ecbrk.Main", {
    onInit: function () {
      this.getView().setModel(new JSONModel({ fileName: "", rows: [], count: 0, busy: false, emptyText: EMPTY }));
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.style.display = "none";
      input.addEventListener("change", (e) => this._onFile(e.target.files[0]));
      document.body.appendChild(input);
      this._input = input;
    },

    onExit: function () {
      this._input.remove();
      if (this._url) URL.revokeObjectURL(this._url);
    },

    onPickFile: function () {
      this._input.value = "";
      this._input.click();
    },

    formatDate: function (iso) {
      if (!iso) return "";
      const [y, m, d] = iso.split("-");
      return d + "/" + m + "/" + y;
    },

    formatAmount: function (v) {
      return v === null || v === undefined ? "" : amount.format(v);
    },

    _onFile: async function (file) {
      if (!file) return;
      const model = this.getView().getModel();
      if (this._url) URL.revokeObjectURL(this._url);
      this._url = URL.createObjectURL(file);
      document.getElementById("pdfPreview").src = this._url;
      model.setData({ fileName: file.name, rows: [], count: 0, busy: true, emptyText: "Elaborazione in corso…" });

      const fail = (fn, msg) => {
        model.setData({ fileName: file.name, rows: [], count: 0, busy: false, emptyText: "Nessun dato" });
        fn.call(MessageBox, msg);
      };
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return fail(res.status === 409 ? MessageBox.warning : MessageBox.error,
            (body.error && body.error.message) || "Errore durante l'elaborazione");
        }
        model.setData({ fileName: file.name, rows: body.righe, count: body.righe.length, busy: false, emptyText: "Nessun dato" });
      } catch (e) {
        fail(MessageBox.error, "Impossibile contattare il server");
      }
    }
  });
});
```

- [ ] **Step 5: Verificare che la pagina si carichi**

Run: `npm start`, aprire `http://localhost:4004/`.
Expected: titolo "Rendiconti provvigionali", pulsante "Carica documento", area sinistra vuota, a destra "Campi estratti (0)" con "Carica un documento PDF". Nessun errore nella console del browser. (L'upload reale si prova nel Task 8.)

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat: interfaccia UI5 con preview PDF e tabella dei campi estratti"
```

---

### Task 8: Verifica locale con i PDF reali e il modello vero

**Files:**
- Create (non versionati): `.env`, `test/fixtures/AON 636016.pdf`, `test/fixtures/IBC VITA.PDF`
- Modify: `srv/lib/llm.js` solo se la verifica lo richiede

I due PDF di esempio sono stati allegati in chat e non sono nel repo: l'utente li copia in `test/fixtures/` (cartella ignorata da git perché contiene dati di clienti).

- [ ] **Step 1: Creare `.env` con le credenziali**

Copiare `.env.example` in `.env` e compilarlo con la service key di AI Core fornita dall'utente: `AI_CORE_CLIENT_ID` = `clientid`, `AI_CORE_CLIENT_SECRET` = `clientsecret`, `AI_CORE_AUTH_URL` = `url`, `AI_API_URL` = `https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com`, `DEPLOYMENT_ID=d5c6e9cb46489b9c`, `RESOURCE_GROUP=default`. Verificare con `git status` che `.env` non compaia tra i file da aggiungere.

- [ ] **Step 2: Provare l'upload di AON 636016**

Run: `npm start`, aprire `http://localhost:4004/` e caricare `AON 636016.pdf`.
Expected: 11 righe (5 a pagina 1, 6 a pagina 2; somma premi 34.265,22 come il totale del documento). La prima: data effetto 31/01/2026, contraente Hünnebeck Italia SpA, polizza `M16067645`, premi 5.725,73 €, provvigioni 444,94 €, data incasso 28/07/2026. L'ultima: Sicoma S.r.l., premi 1.354,04 €, provvigioni 221,52 €. Nessuna riga di totale. La preview a sinistra mostra il PDF.

- [ ] **Step 3: Provare l'upload di IBC VITA (scansione)**

Caricare `IBC VITA.PDF`.
Expected: 3 righe. Prima: VALENTINO SILVIA, polizza `773016-0001`, premi 51,66 €, provvigioni 1,50 €, data effetto 16/06/2026, data incasso 16/06/2026. Seconda: CLEANER SRL, `750893-0001`, premi 1.987,50 €, provvigioni 59,62 €, data effetto 01/07/2026, data incasso 13/07/2026. Terza: VALENTINO SILVIA, `773016-0001`, premi 51,66 €, provvigioni 1,50 €, effetto e incasso 16/07/2026.

- [ ] **Step 4: Provare il duplicato**

Ricaricare `AON 636016.pdf`.
Expected: avviso "Documento già caricato il gg/mm/aaaa", tabella invariata, nessuna nuova chiamata al modello (controllare il log del server).

- [ ] **Step 5: Controllare il database**

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('db.sqlite');console.log(d.prepare('select count(*) n from itas_ecbrk_Documents').get(), d.prepare('select count(*) n from itas_ecbrk_Policies').get())"
```

Expected: 2 documenti e 14 righe di polizza.

- [ ] **Step 6: Correggere se necessario**

Se la chiamata fallisce o i valori sono sbagliati, correggere e ripetere i passi 2-5:

- Errore `400`/`404` sull'API: verificare `AI_API_VERSION` e l'URL del deployment; provare una chiamata `curl` alla stessa URL con un messaggio semplice.
- `response_format` rifiutato: rimuoverlo da `srv/lib/llm.js` (il prompt chiede già solo JSON) e aggiornare il test corrispondente in `test/lib/llm.test.js`.
- Immagini rifiutate: verificare che il deployment accetti `image_url`; in caso contrario segnalarlo all'utente (serve un modello con visione).
- Righe mancanti o campi sbagliati: raffinare `SYSTEM_PROMPT` in `srv/lib/llm.js` con l'esempio del documento problematico, senza inserire dati reali di clienti nel codice.

Dopo ogni modifica `npm test` deve restare verde.

- [ ] **Step 7: Commit (solo se ci sono modifiche al codice)**

```bash
git add srv test
git commit -m "fix: adeguamento a risposta reale del deployment GPT-5.5"
```

---

### Task 9: MTA, documentazione e push su GitHub

**Files:**
- Create: `mta.yaml`
- Modify: `readme.md`, `package.json` (auth `dummy`)

- [ ] **Step 1: Disabilitare l'autenticazione CAP in produzione**

In `package.json`, dentro `cds.requires` aggiungere `"auth": { "kind": "dummy" }` accanto a `db`. Senza questa riga in produzione CAP si aspetta un binding XSUAA e blocca le richieste.

- [ ] **Step 2: Provare il profilo produzione in locale**

Run: `NODE_ENV=production npm start`, poi `curl -s http://localhost:4004/odata/archivio/Documents` e aprire `http://localhost:4004/`.
Expected: risposta JSON (non `401`) e pagina caricata. Fermare il server.

- [ ] **Step 3: Creare `mta.yaml`**

```yaml
_schema-version: '3.3.0'
ID: itas-ecbrk
version: 1.0.0
description: Estrazione rendiconti PDF con GPT-5.5 su SAP AI Core

modules:
  - name: itas-ecbrk-srv
    type: nodejs
    path: .
    parameters:
      buildpack: nodejs_buildpack
      command: npm start
      memory: 1024M
      disk-quota: 1024M
      instances: 1
    properties:
      DEPLOYMENT_ID: d5c6e9cb46489b9c
      RESOURCE_GROUP: default
    requires:
      - name: itas-ecbrk-aicore
    build-parameters:
      builder: npm-ci
      ignore:
        - node_modules/
        - test/
        - docs/
        - mta_archives/
        - .env
        - db.sqlite*
        - gen/

resources:
  - name: itas-ecbrk-aicore
    type: org.cloudfoundry.existing-service
    parameters:
      service-name: aicore-instance-name
```

Sostituire `aicore-instance-name` con il nome dell'istanza AI Core mostrato da `cf services` nello spazio di deploy. Se l'istanza non è visibile in quello spazio (subaccount diverso), togliere il blocco `requires` e la sezione `resources`, e impostare le credenziali dopo il deploy con `cf set-env itas-ecbrk-srv AI_CORE_CLIENT_ID ...` (e le altre variabili di `.env.example`), poi `cf restage itas-ecbrk-srv`.

- [ ] **Step 4: Scrivere `readme.md`**

Sostituire il contenuto con queste sezioni: a) descrizione dell'app; b) sviluppo locale (`npm install`, `.env` da `.env.example`, `npm start`, `npm test`); c) deploy su CF (`npm install -g mbt`, `mbt build`, `cf login`, `cf deploy mta_archives/itas-ecbrk_1.0.0.mtar`); d) note: nessuna autenticazione (app interna), SQLite senza persistenza su CF (i dati si perdono a restart/restage), controllo duplicati per hash del file, limite 10 MB, il modello può saltare righe nelle tabelle lunghe (controllare il conteggio), licenza AGPL della libreria `mupdf`, nessun segreto nel repo.

- [ ] **Step 5: Eseguire tutti i test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mta.yaml readme.md package.json
git commit -m "chore: MTA per Cloud Foundry, readme e auth dummy in produzione"
```

- [ ] **Step 7: Push su GitHub**

Controllare `git remote -v`. Se non c'è `origin`, chiedere all'utente l'URL del repository e poi:

```bash
git remote add origin <URL>
git push -u origin main
```

Prima del push, `git log -p --all -S"clientsecret"` non deve trovare la chiave nel repo.

- [ ] **Step 8: Istruzioni per l'utente in BAS**

Comunicare all'utente i passi: clonare il repo in BAS, creare `.env` (per eventuali prove locali), `npm install`, `mbt build`, `cf login`, `cf deploy mta_archives/itas-ecbrk_1.0.0.mtar`, e ripetere la prova del Task 8 sull'URL pubblico dell'app (`cf apps`). Da verificare solo lì: memoria dell'app con le immagini e raggiungibilità di AI Core dal container (log con `cf logs itas-ecbrk-srv --recent`).

---

## Self-Review

- **Copertura della spec:** modello dati e vincoli (Task 1); conversioni e validazione (Task 2); configurazione e segreti (Task 3, 9); estrazione testo/immagini (Task 4); chiamata al modello (Task 5); upload, duplicati, transazione, errori 400/409/413/422/502/500 (Task 6); UI con preview, tabella, conteggio righe, avvisi (Task 7); prova con PDF reali e duplicato (Task 8); MTA, readme, push (Task 9). Test su CF e `cf deploy` restano all'utente, come da spec.
- **Placeholder:** gli unici valori da inserire a mano sono `aicore-instance-name` (nome istanza AI Core, noto solo dal `cf services` dell'utente) e l'URL del repo GitHub.
- **Coerenza dei tipi:** `normalizeRows` restituisce `dataEffetto`, `contraente`, `numeroPolizza`, `premi`, `provvigioni`, `dataIncasso`, gli stessi nomi usati da `upload.js` (Task 6) e dalla UI (Task 7); le entità sono `itas.ecbrk.Documents`/`Policies` in tutti i task; `createLlmClient().extractPolicies({ text, images })` accetta l'output di `extractContent` (Task 4).
