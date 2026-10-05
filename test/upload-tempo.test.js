const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { memDb } = require('./helpers/db')
const { makePdf } = require('./helpers/makePdf')
const { createUploadHandler, errorHandler } = require('../srv/upload')

const RIGHE = [{ dataEffetto: '31/01/2026', contraente: 'ACME', numeroPolizza: 'P1', premi: '1.000,00', provvigioni: '10,00', dataIncasso: '28/07/2026' }]

async function start (extract) {
  const db = await memDb()
  const app = express()
  app.post('/upload', createUploadHandler({ db, extract }))
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

test('la risposta riporta il tempo di elaborazione in millisecondi, che include la lettura del modello', async () => {
  const t = await start(async () => { await new Promise(r => setTimeout(r, 120)); return { righe: RIGHE } })
  const body = await (await t.post(makePdf('tempo uno'))).json()
  assert.ok(Number.isInteger(body.tempoElaborazioneMs), 'intero')
  assert.ok(body.tempoElaborazioneMs >= 100, `almeno la durata dell'estrazione, trovato ${body.tempoElaborazioneMs}`)
  assert.ok(body.tempoElaborazioneMs < 5000, `non include attese anomale, trovato ${body.tempoElaborazioneMs}`)
  t.close()
})

test('estrazione istantanea: tempo piccolo ma presente (non null né negativo)', async () => {
  const t = await start(async () => ({ righe: RIGHE }))
  const body = await (await t.post(makePdf('tempo due'))).json()
  assert.ok(Number.isInteger(body.tempoElaborazioneMs) && body.tempoElaborazioneMs >= 0)
  t.close()
})
