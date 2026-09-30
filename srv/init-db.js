// Crea il file SQLite con lo schema se non esiste (su CF il filesystem è effimero: riparte vuoto a ogni restart)
const fs = require('node:fs')
const cds = require('@sap/cds')

async function main () {
  const file = cds.env.requires.db.credentials.url
  if (fs.existsSync(file)) return
  const db = await cds.connect.to('db')
  await cds.deploy('*').to(db)
  await db.disconnect()
  console.log(`[init-db] creato ${file}`)
}

main().catch(e => { console.error(e); process.exit(1) })
