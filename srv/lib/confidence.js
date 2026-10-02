// "Parsing Confidence Score": indice di coerenza dell'estrazione, in percentuale per documento.
// Non è una probabilità del modello (i modelli generativi non ne danno una affidabile):
// è calcolato da controlli oggettivi sul risultato.
//   - completezza (peso 40): quota dei campi di ogni riga letti e validi; i campi che il documento non
//     riporta affatto (vuoti in tutte le righe) sono esclusi dal calcolo;
//   - quadratura premi (peso 30) e provvigioni (peso 30): la somma delle righe coincide con il totale
//     stampato nel documento (tolleranza 2 centesimi). Se il documento non stampa il totale, il controllo
//     è escluso e i pesi degli altri si riscalano.
const FIELDS = ['dataEffetto', 'contraente', 'numeroPolizza', 'premi', 'provvigioni', 'dataIncasso']
const WEIGHTS = { completezza: 40, premi: 30, provvigioni: 30 }
const TOLERANCE_CENTS = 2

const round2 = n => Math.round(n * 100) / 100

function reconcile (righe, key, documento) {
  if (documento === null || documento === undefined) return null
  const somma = round2(righe.reduce((acc, r) => acc + (r[key] || 0), 0))
  return { righe: somma, documento, quadra: Math.round(Math.abs(somma - documento) * 100) <= TOLERANCE_CENTS }
}

function computeConfidence ({ righe, totali = {} }) {
  // un campo vuoto in tutte le righe è un'informazione che il documento non riporta: non conta nel calcolo.
  // Un campo presente solo in alcune righe è invece una lacuna dell'estrazione e abbassa la completezza.
  const present = (r, f) => r[f] !== null && r[f] !== undefined
  const active = FIELDS.filter(f => righe.some(r => present(r, f)))
  const campiAssenti = righe.length ? FIELDS.filter(f => !active.includes(f)) : []
  const cells = righe.length * active.length
  const filled = righe.reduce((acc, r) => acc + active.filter(f => present(r, f)).length, 0)
  const completezza = cells ? Math.round((filled / cells) * 100) : 0
  const premi = reconcile(righe, 'premi', totali.premi)
  const provvigioni = reconcile(righe, 'provvigioni', totali.provvigioni)

  const parts = [{ w: WEIGHTS.completezza, v: completezza }]
  if (premi) parts.push({ w: WEIGHTS.premi, v: premi.quadra ? 100 : 0 })
  if (provvigioni) parts.push({ w: WEIGHTS.provvigioni, v: provvigioni.quadra ? 100 : 0 })
  const weight = parts.reduce((a, p) => a + p.w, 0)
  const score = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / weight)
  return { score, completezza, campiAssenti, premi, provvigioni }
}

module.exports = { computeConfidence }
