// Crea il file SQLite con lo schema se non esiste (su CF il filesystem è effimero: riparte vuoto a ogni restart)
// e aggiorna un file creato con lo schema vecchio conservandone i dati
const cds = require('@sap/cds')
const { initDb } = require('./lib/init-db')

const file = cds.env.requires.db.credentials.url

initDb(file)
  .then(r => { if (r.created) console.log(`[init-db] creato ${file}`); if (r.migrated) console.log(`[init-db] aggiornato ${file} (dati conservati; se è stato ricreato resta una copia ${file}.bak-*)`) })
  .catch(e => { console.error(e); process.exit(1) })
