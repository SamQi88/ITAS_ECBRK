const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseDate, parseAmount, normalizeRows, normalizeRitenuta, normalizeTotali } = require('../../srv/lib/schema')

test('parseDate converte gg/mm/aaaa e rifiuta il resto', () => {
  assert.equal(parseDate('31/01/2026'), '2026-01-31')
  assert.equal(parseDate('1/7/2026'), '2026-07-01')
  assert.equal(parseDate('2026-07-01'), '2026-07-01')
  assert.equal(parseDate('31/02/2026'), null)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
  assert.equal(parseDate('ieri'), null)
})

test('parseDate accetta separatori . e - e anni a due cifre', () => {
  assert.equal(parseDate('01.02.2026'), '2026-02-01')
  assert.equal(parseDate('01-02-2026'), '2026-02-01')
  assert.equal(parseDate('1/2/26'), '2026-02-01')
  assert.equal(parseDate('31/02/26'), null)
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

test('parseAmount conserva il segno in stile contabile (meno finale, parentesi)', () => {
  assert.equal(parseAmount('1.927,76-'), -1927.76)
  assert.equal(parseAmount('(1.927,76)'), -1927.76)
  assert.equal(parseAmount('-1.927,76'), -1927.76)
  assert.equal(parseAmount('0,00-'), 0)
})

test('normalizeRitenuta legge l\'importo complessivo, null se assente o illeggibile', () => {
  assert.equal(normalizeRitenuta({ ritenutaAcconto: '234,92' }), 234.92)
  assert.equal(normalizeRitenuta({ ritenutaAcconto: '2,88' }), 2.88)
  assert.equal(normalizeRitenuta({ ritenutaAcconto: 234.92 }), 234.92)
  assert.equal(normalizeRitenuta({ ritenutaAcconto: '1.234,50' }), 1234.5)
  assert.equal(normalizeRitenuta({ ritenutaAcconto: null }), null)
  assert.equal(normalizeRitenuta({ ritenutaAcconto: 'n/d' }), null)
  assert.equal(normalizeRitenuta({ righe: [] }), null)
  assert.equal(normalizeRitenuta(null), null)
})

test('normalizeTotali legge i totali stampati nel documento, null se assenti o illeggibili', () => {
  assert.deepEqual(normalizeTotali({ totalePremiDocumento: '34.265,22', totaleProvvigioniDocumento: '5.107,02' }), { premi: 34265.22, provvigioni: 5107.02 })
  assert.deepEqual(normalizeTotali({ totalePremiDocumento: 2090.82, totaleProvvigioniDocumento: '62,62' }), { premi: 2090.82, provvigioni: 62.62 })
  assert.deepEqual(normalizeTotali({ totalePremiDocumento: null }), { premi: null, provvigioni: null })
  assert.deepEqual(normalizeTotali({ totalePremiDocumento: 'n/d', totaleProvvigioniDocumento: '' }), { premi: null, provvigioni: null })
  assert.deepEqual(normalizeTotali(null), { premi: null, provvigioni: null })
})
