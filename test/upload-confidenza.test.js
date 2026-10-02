const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { memDb } = require('./helpers/db')
const { makePdf } = require('./helpers/makePdf')
const { createUploadHandler, errorHandler } = require('../srv/upload')

const riga = (premi, provv) => ({ dataEffetto: '31/01/2026', contraente: 'ACME', numeroPolizza: 'P1', premi, provvigioni: provv, dataIncasso: '28/07/2026' })
const TRE = [riga('100,00', '10,00'), riga('200,00', '20,00'), riga('300,00', '30,00')]

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
  return { post, close: () => server.close() }
}

test('totali del documento quadrati: confidenza 100 con il dettaglio', async () => {
  const t = await start({ righe: TRE, totalePremiDocumento: '600,00', totaleProvvigioniDocumento: '60,00' })
  const body = await (await t.post(makePdf('conf uno'))).json()
  assert.equal(body.confidenza.score, 100)
  assert.equal(body.confidenza.completezza, 100)
  assert.deepEqual(body.confidenza.premi, { righe: 600, documento: 600, quadra: true })
  t.close()
})

test('riga saltata dall\'IA: totali che non quadrano, punteggio basso, ma il file viene salvato e mostrato', async () => {
  const t = await start({ righe: TRE.slice(0, 2), totalePremiDocumento: '600,00', totaleProvvigioniDocumento: '60,00' })
  const res = await t.post(makePdf('conf due'))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.righe.length, 2)
  assert.equal(body.confidenza.score, 40)
  assert.equal(body.confidenza.premi.quadra, false)
  assert.equal(body.confidenza.premi.righe, 300)
  assert.equal(body.confidenza.premi.documento, 600)
  t.close()
})

test('il documento non riporta i totali: confidenza dalla sola completezza, dettagli null', async () => {
  const t = await start({ righe: TRE })
  const body = await (await t.post(makePdf('conf tre'))).json()
  assert.equal(body.confidenza.score, 100)
  assert.equal(body.confidenza.premi, null)
  assert.equal(body.confidenza.provvigioni, null)
  t.close()
})

test('campo che il documento non riporta: non penalizza e viene indicato nella risposta', async () => {
  const senzaData = TRE.map(r => ({ ...r, dataEffetto: null }))
  const t = await start({ righe: senzaData, totalePremiDocumento: '600,00', totaleProvvigioniDocumento: '60,00' })
  const body = await (await t.post(makePdf('conf quattro'))).json()
  assert.equal(body.confidenza.score, 100)
  assert.deepEqual(body.confidenza.campiAssenti, ['dataEffetto'])
  t.close()
})
