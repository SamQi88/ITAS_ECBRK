const { HttpError } = require('./errors')

function parseDate (v) {
  if (v == null) return null
  const s = String(v).trim()
  let y, m, d
  let mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3] }
  else if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3] }
  else return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseAmount (v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).replace(/[^\d,.\-]/g, '')
  if (!/\d/.test(s)) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const text = v => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function normalizeRows (raw) {
  if (!raw || !Array.isArray(raw.righe)) throw new HttpError(502, 'Risposta del modello non valida', 'BAD_MODEL_RESPONSE')
  return raw.righe
    .map(r => ({
      dataEffetto: parseDate(r && r.dataEffetto),
      contraente: text(r && r.contraente),
      numeroPolizza: text(r && r.numeroPolizza),
      premi: parseAmount(r && r.premi),
      provvigioni: parseAmount(r && r.provvigioni),
      dataIncasso: parseDate(r && r.dataIncasso)
    }))
    .filter(r => r.contraente || r.numeroPolizza)
}

module.exports = { parseDate, parseAmount, normalizeRows }
