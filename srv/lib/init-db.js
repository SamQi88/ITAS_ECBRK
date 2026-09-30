const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const cds = require('@sap/cds')

const DOCS = 'itas_ecbrk_Documents'
const POLS = 'itas_ecbrk_Policies'

// Lo schema vecchio aveva UNIQUE su HASH_SHA256 e SQLite non permette di togliere un vincolo:
// un file creato allora bloccherebbe con un errore i file duplicati che ora sono ammessi.
function readIfOutdated (file) {
  const d = new DatabaseSync(file)
  try {
    const t = d.prepare("select sql from sqlite_master where type = 'table' and name = ?").get(DOCS)
    if (!t || !/UNIQUE/i.test(t.sql)) return null
    return { docs: d.prepare(`select * from ${DOCS}`).all(), pols: d.prepare(`select * from ${POLS}`).all() }
  } finally { d.close() }
}

// inserimento diretto: passando da CDS la data di caricamento verrebbe sovrascritta da $now
function restore (file, table, rows) {
  if (!rows.length) return
  const d = new DatabaseSync(file)
  try {
    for (const row of rows) {
      const cols = Object.keys(row)
      d.prepare(`insert into ${table} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c]))
    }
  } finally { d.close() }
}

async function initDb (file) {
  let saved = null
  if (fs.existsSync(file)) {
    saved = readIfOutdated(file)
    if (!saved) return { created: false, migrated: false }
    fs.renameSync(file, `${file}.bak-${Date.now()}`) // copia di sicurezza, mai cancellare i dati
  }
  const db = await cds.connect.to('db')
  await cds.deploy('*').to(db)
  await db.disconnect()
  if (saved) {
    restore(file, DOCS, saved.docs)
    restore(file, POLS, saved.pols)
  }
  return { created: !saved, migrated: Boolean(saved) }
}

module.exports = { initDb }
