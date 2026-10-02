const { test } = require('node:test')
const assert = require('node:assert/strict')
const { computeConfidence } = require('../../srv/lib/confidence')

const row = (over = {}) => ({ dataEffetto: '2026-01-31', contraente: 'ACME', numeroPolizza: 'P1', premi: 100, provvigioni: 10, dataIncasso: '2026-07-28', ...over })
const rows3 = [row(), row({ premi: 200, provvigioni: 20 }), row({ premi: 300, provvigioni: 30 })] // totali righe: 600 e 60

test('estrazione completa e totali quadrati: 100', () => {
  const c = computeConfidence({ righe: rows3, totali: { premi: 600, provvigioni: 60 } })
  assert.equal(c.score, 100)
  assert.equal(c.completezza, 100)
  assert.deepEqual(c.premi, { righe: 600, documento: 600, quadra: true })
  assert.deepEqual(c.provvigioni, { righe: 60, documento: 60, quadra: true })
})

test('una riga saltata dall\'IA: i totali non quadrano e il punteggio crolla', () => {
  // il documento ha totali 600/60 ma l'IA ha restituito solo due righe (300 e 30)
  const c = computeConfidence({ righe: rows3.slice(0, 2), totali: { premi: 600, provvigioni: 60 } })
  assert.equal(c.premi.quadra, false)
  assert.equal(c.provvigioni.quadra, false)
  assert.equal(c.score, 40) // solo la completezza (peso 40%) resta
})

test('un solo totale non quadra: perde solo il suo peso', () => {
  const c = computeConfidence({ righe: rows3, totali: { premi: 600, provvigioni: 99 } })
  assert.equal(c.premi.quadra, true)
  assert.equal(c.provvigioni.quadra, false)
  assert.equal(c.score, 70)
})

test('totali del documento assenti: quel controllo è escluso e i pesi si riscalano', () => {
  const c = computeConfidence({ righe: rows3, totali: { premi: null, provvigioni: null } })
  assert.equal(c.premi, null)
  assert.equal(c.provvigioni, null)
  assert.equal(c.score, 100) // solo completezza, tutta piena
  const solo = computeConfidence({ righe: rows3, totali: { premi: 600, provvigioni: null } })
  assert.equal(solo.score, 100)
  assert.equal(computeConfidence({ righe: rows3, totali: { premi: 1, provvigioni: null } }).score, Math.round(100 * 0.4 / 0.7))
})

test('campi mancanti nelle righe riducono la completezza', () => {
  const righe = [row({ dataEffetto: null }), row({ contraente: null, dataIncasso: null })] // 3 campi su 12 mancanti
  const c = computeConfidence({ righe, totali: { premi: 200, provvigioni: 20 } })
  assert.equal(c.completezza, 75)
  assert.equal(c.score, Math.round(0.4 * 75 + 0.3 * 100 + 0.3 * 100))
})

test('importo zero è un valore letto (completo); null no', () => {
  const c = computeConfidence({ righe: [row({ premi: 0, provvigioni: 0 })], totali: { premi: 0, provvigioni: 0 } })
  assert.equal(c.completezza, 100)
  assert.equal(c.score, 100)
})

test('campo assente in tutto il documento: non è considerato nel calcolo e viene segnalato', () => {
  // nessuna riga ha la data di effetto: il documento non la riporta
  const righe = [row({ dataEffetto: null }), row({ dataEffetto: null }), row({ dataEffetto: null })]
  const c = computeConfidence({ righe, totali: { premi: 300, provvigioni: 30 } })
  assert.equal(c.completezza, 100) // prima: 83, penalizzava un'informazione che non c'è
  assert.equal(c.score, 100)
  assert.deepEqual(c.campiAssenti, ['dataEffetto'])
})

test('più campi assenti nel documento: tutti esclusi, quelli presenti restano controllati', () => {
  const righe = [row({ dataEffetto: null, dataIncasso: null }), row({ dataEffetto: null, dataIncasso: null, contraente: null })]
  const c = computeConfidence({ righe, totali: {} })
  assert.deepEqual(c.campiAssenti, ['dataEffetto', 'dataIncasso'])
  // restano 4 campi per riga (contraente, polizza, premi, provvigioni): 1 mancante su 8
  assert.equal(c.completezza, 88)
  assert.equal(c.score, 88)
})

test('campo presente solo in alcune righe: resta una lacuna e abbassa il punteggio', () => {
  const righe = [row(), row({ dataEffetto: null }), row({ dataEffetto: null })]
  const c = computeConfidence({ righe, totali: { premi: 600, provvigioni: 60 } })
  assert.deepEqual(c.campiAssenti, [])
  assert.equal(c.completezza, 89) // 16 campi su 18
})

test('nessun campo assente: elenco vuoto', () => {
  assert.deepEqual(computeConfidence({ righe: rows3, totali: {} }).campiAssenti, [])
})

test('tolleranza di 2 centesimi sui totali; oltre, non quadra', () => {
  const ok = computeConfidence({ righe: rows3, totali: { premi: 600.02, provvigioni: 59.98 } })
  assert.equal(ok.premi.quadra, true)
  assert.equal(ok.provvigioni.quadra, true)
  const ko = computeConfidence({ righe: rows3, totali: { premi: 600.03, provvigioni: 60 } })
  assert.equal(ko.premi.quadra, false)
})

test('somma con decimali: nessun errore di arrotondamento sui centesimi', () => {
  const righe = [row({ premi: 0.1, provvigioni: 0.1 }), row({ premi: 0.2, provvigioni: 0.2 })]
  const c = computeConfidence({ righe, totali: { premi: 0.3, provvigioni: 0.3 } })
  assert.equal(c.premi.righe, 0.3)
  assert.equal(c.score, 100)
})

test('senza righe o senza totali nell\'oggetto: non si rompe', () => {
  assert.equal(computeConfidence({ righe: [], totali: {} }).score, 0)
  assert.equal(computeConfidence({ righe: rows3 }).score, 100)
})
