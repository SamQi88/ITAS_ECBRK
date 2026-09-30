const cds = require('@sap/cds')
const path = require('node:path')

async function memDb () {
  if (cds.db) { await cds.db.disconnect(); delete cds.services.db; delete cds.db }
  cds.env.requires.db = { kind: 'sqlite', impl: '@cap-js/sqlite', credentials: { url: ':memory:' } }
  const db = await cds.connect.to('db')
  await cds.deploy(path.join(__dirname, '../../db')).to(db)
  return db
}

module.exports = { memDb }
