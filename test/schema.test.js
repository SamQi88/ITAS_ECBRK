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

test('ogni chiamata di memDb restituisce un db pulito', async () => {
  const { INSERT, SELECT } = cds.ql
  const a = await memDb()
  await a.run(INSERT.into('itas.ecbrk.Documents').entries({ ID_OPERAZIONE: cds.utils.uuid(), NOME_DOCUMENTO: 'x.pdf', HASH_SHA256: 'h-reset' }))
  const b = await memDb()
  assert.equal((await b.run(SELECT.from('itas.ecbrk.Documents'))).length, 0)
})
