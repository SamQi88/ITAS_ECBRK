const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const cds = require('@sap/cds')
const { createUploadHandler, errorHandler } = require('./upload')
const { createModelHandler } = require('./model')
const { loadConfig } = require('./lib/config')
const { createLlmClient } = require('./lib/llm')
const { extractContent } = require('./lib/pdf')

if (fs.existsSync('.env')) process.loadEnvFile('.env')

let llm
const extract = async buffer => {
  const t0 = Date.now()
  const content = await extractContent(buffer)
  // solo metadati: il testo del documento contiene dati di clienti
  const modo = content.images.length ? `immagini=${content.images.length}` : `testo=${content.text.length}car`
  console.log(`[extract] pdf=${Date.now() - t0}ms ${modo} byte=${buffer.length}`)
  llm ||= createLlmClient({ config: loadConfig() })
  return llm.extractPolicies(content)
}

cds.on('bootstrap', app => {
  app.get('/api/model', createModelHandler())
  app.post('/upload', (req, res, next) => {
    const t0 = Date.now()
    res.on('finish', () => console.log(`[upload] totale=${Date.now() - t0}ms stato=${res.statusCode}`))
    createUploadHandler({ db: cds.db, extract })(req, res, next)
  })
  app.use('/', express.static(path.join(__dirname, '../app/webapp')))
  app.use(errorHandler)
})

module.exports = cds.server
