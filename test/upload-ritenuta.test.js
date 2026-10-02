const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const cds = require('@sap/cds')
const { memDb } = require('./helpers/db')
const { makePdf } = require('./helpers/makePdf')
const { createUploadHandler, errorHandler } = require('../srv/upload')

const RIGHE = [{ dataEffetto: '31/01/2026', contraente: 'ACME', numeroPolizza: 'P1', premi: '1.000,00', provvigioni: '10,00', dataIncasso: '28/07/2026' }]

async function start (extractResult) {
  const db = await memDb()
  const app = express()
  app.post('/upload', createUploadHandler({ db, extract: async () => extractResult }))
  app.use(errorHandler)
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  server.unref()
  const post = buf => {
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), 'a.pdf')
    return fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: fd })
  }
  return { db, post, close: () => server.close() }
}

test('ritenuta d\'acconto letta dal modello: nella risposta e salvata sul documento', async () => {
  const t = await start({ righe: RIGHE, ritenutaAcconto: '234,92' })
  const body = await (await t.post(makePdf('ritenuta uno'))).json()
  assert.equal(body.ritenutaAcconto, 234.92)
  const doc = await t.db.run(cds.ql.SELECT.one.from('itas.ecbrk.Documents').where({ ID_OPERAZIONE: body.idOperazione }))
  assert.equal(Number(doc.RITENUTA_ACCONTO), 234.92) // CAP restituisce i Decimal come stringa
  t.close()
})

test('ritenuta assente nel documento: null nella risposta e nel database', async () => {
  const t = await start({ righe: RIGHE })
  const res = await t.post(makePdf('ritenuta due'))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.ritenutaAcconto, null)
  const doc = await t.db.run(cds.ql.SELECT.one.from('itas.ecbrk.Documents').where({ ID_OPERAZIONE: body.idOperazione }))
  assert.equal(doc.RITENUTA_ACCONTO, null)
  t.close()
})
