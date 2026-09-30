const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')

// schema com'era prima di consentire i duplicati: UNIQUE su HASH_SHA256
const OLD_SCHEMA = `namespace itas.ecbrk;
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
`

// ogni scenario gira in un processo a parte, come `npm start`: CDS non supporta bene
// più deploy verso file diversi nello stesso processo
const cdsConfig = file => JSON.stringify({ requires: { db: { kind: 'sqlite', credentials: { url: file } } } })
const run = (args, file) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CDS_CONFIG: cdsConfig(file) } })
const runInit = file => run(['srv/init-db.js'], file)

function makeOldDb (dir) {
  const file = path.join(dir, 'old.sqlite')
  const model = path.join(dir, 'old-schema.cds')
  fs.writeFileSync(model, OLD_SCHEMA)
  run(['-e', `const cds = require('@sap/cds'); (async () => { const db = await cds.connect.to('db'); await cds.deploy(${JSON.stringify(model)}).to(db); await db.disconnect() })()`], file)
  const d = new DatabaseSync(file)
  d.prepare("insert into itas_ecbrk_Documents (ID_OPERAZIONE, NOME_DOCUMENTO, HASH_SHA256, DATA_CARICAMENTO) values ('op-1', 'vecchio.pdf', 'h1', '2026-01-02T03:04:05.000Z')").run()
  d.prepare("insert into itas_ecbrk_Policies (ID, ID_OPERAZIONE, NOME_DOCUMENTO, CONTRAENTE, NUMERO_POLIZZA, PREMI) values ('p-1', 'op-1', 'vecchio.pdf', 'ACME', 'P1', 10.5)").run()
  d.close()
  return file
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'initdb-'))

test('DB creato con lo schema vecchio: vincolo UNIQUE tolto, dati e data di caricamento conservati', () => {
  const dir = tmp()
  const file = makeOldDb(dir)
  assert.match(runInit(file), /aggiornato/)

  const d = new DatabaseSync(file)
  const docs = d.prepare('select * from itas_ecbrk_Documents').all()
  assert.equal(docs.length, 1)
  assert.equal(docs[0].NOME_DOCUMENTO, 'vecchio.pdf')
  assert.equal(docs[0].DATA_CARICAMENTO, '2026-01-02T03:04:05.000Z')
  assert.equal(d.prepare('select * from itas_ecbrk_Policies').all()[0].CONTRAENTE, 'ACME')
  // lo stesso hash ora si può inserire di nuovo
  d.prepare("insert into itas_ecbrk_Documents (ID_OPERAZIONE, NOME_DOCUMENTO, HASH_SHA256) values ('op-2', 'vecchio.pdf', 'h1')").run()
  assert.equal(d.prepare('select count(*) n from itas_ecbrk_Documents').get().n, 2)
  d.close()
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('old.sqlite.bak')), 'copia di sicurezza del file originale')
})

test('DB assente: viene creato con lo schema; DB già aggiornato: non viene toccato', () => {
  const dir = tmp()
  const file = path.join(dir, 'new.sqlite')
  assert.match(runInit(file), /creato/)

  const d = new DatabaseSync(file)
  d.prepare("insert into itas_ecbrk_Documents (ID_OPERAZIONE, NOME_DOCUMENTO, HASH_SHA256) values ('op-1', 'a.pdf', 'h')").run()
  d.close()

  assert.doesNotMatch(runInit(file), /creato|aggiornato/)
  const d2 = new DatabaseSync(file)
  assert.equal(d2.prepare('select count(*) n from itas_ecbrk_Documents').get().n, 1)
  d2.close()
  assert.equal(fs.readdirSync(dir).filter(f => f.includes('.bak')).length, 0)
})
