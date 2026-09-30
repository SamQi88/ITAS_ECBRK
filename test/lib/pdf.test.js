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
