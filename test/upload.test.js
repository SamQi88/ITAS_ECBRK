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
