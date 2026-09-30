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
