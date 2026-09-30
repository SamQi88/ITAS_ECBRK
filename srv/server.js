const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const cds = require('@sap/cds')
const { createUploadHandler, errorHandler } = require('./upload')
const { loadConfig } = require('./lib/config')
const { createLlmClient } = require('./lib/llm')
const { extractContent } = require('./lib/pdf')

if (fs.existsSync('.env')) process.loadEnvFile('.env')

let llm
const extract = async buffer => {
  const content = await extractContent(buffer)
  llm ||= createLlmClient({ config: loadConfig() })
  return llm.extractPolicies(content)
}

cds.on('bootstrap', app => {
  app.post('/upload', (req, res, next) => createUploadHandler({ db: cds.db, extract })(req, res, next))
  app.use('/', express.static(path.join(__dirname, '../app/webapp')))
  app.use(errorHandler)
})

module.exports = cds.server
