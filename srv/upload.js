const crypto = require('node:crypto')
const multer = require('multer')
const cds = require('@sap/cds')
const { HttpError } = require('./lib/errors')
const { normalizeRows } = require('./lib/schema')

const DOC = 'itas.ecbrk.Documents'
const POL = 'itas.ecbrk.Policies'

// busboy legge il nome file come latin1: si ricodifica in utf8 se il risultato è valido
function cleanName (original) {
  let n = String(original || 'documento.pdf')
  const recoded = Buffer.from(n, 'latin1').toString('utf8')
  if (!recoded.includes('\uFFFD')) n = recoded
  n = n.split(/[\\/]/).pop().trim()
  return (n || 'documento.pdf').slice(0, 255)
}

const fmtDate = ts => {
  const d = ts ? new Date(ts) : new Date()
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}
const duplicate = doc => new HttpError(409, `Documento già caricato il ${fmtDate(doc && doc.DATA_CARICAMENTO)}`, 'DUPLICATE')

function createUploadHandler ({ db, extract, maxBytes = 10 * 1024 * 1024 }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single('file')
  const { SELECT, INSERT } = cds.ql
  const findByHash = hash => db.run(SELECT.one.from(DOC).columns('DATA_CARICAMENTO').where({ HASH_SHA256: hash }))

  return (req, res, next) => {
    upload(req, res, async err => {
      try {
        if (err) {
          throw err.code === 'LIMIT_FILE_SIZE'
            ? new HttpError(413, 'File troppo grande (massimo 10 MB)', 'TOO_LARGE')
            : new HttpError(400, 'Upload non valido', 'BAD_UPLOAD')
        }
        const file = req.file
        if (!file) throw new HttpError(400, 'Nessun file ricevuto', 'NO_FILE')
        if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Il file non è un PDF', 'NOT_PDF')

        const nome = cleanName(file.originalname)
        const hash = crypto.createHash('sha256').update(file.buffer).digest('hex')

        const existing = await findByHash(hash)
        if (existing) throw duplicate(existing)

        const righe = normalizeRows(await extract(file.buffer))
        if (!righe.length) throw new HttpError(422, 'Nessuna polizza trovata', 'NO_ROWS')

        const id = cds.utils.uuid()
        try {
          await db.tx(async tx => {
            await tx.run(INSERT.into(DOC).entries({ ID_OPERAZIONE: id, NOME_DOCUMENTO: nome, HASH_SHA256: hash }))
            await tx.run(INSERT.into(POL).entries(righe.map(r => ({
              ID_OPERAZIONE: id, NOME_DOCUMENTO: nome,
              DATA_EFFETTO: r.dataEffetto, CONTRAENTE: r.contraente, NUMERO_POLIZZA: r.numeroPolizza,
              PREMI: r.premi, PROVVIGIONI: r.provvigioni, DATA_INCASSO: r.dataIncasso
            }))))
          })
        } catch (e) {
          if (/UNIQUE/i.test(e.message)) throw duplicate(await findByHash(hash))
          throw e
        }
        res.status(201).json({ idOperazione: id, nomeDocumento: nome, righe })
      } catch (e) { next(e) }
    })
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler (err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } })
  console.error('[upload]', err)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Errore interno durante l\'elaborazione' } })
}

module.exports = { createUploadHandler, errorHandler }
