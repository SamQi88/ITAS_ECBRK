const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { modelInfo } = require('../srv/lib/config')
const { createModelHandler } = require('../srv/model')
const { errorHandler } = require('../srv/upload')

test('modelInfo: nome leggibile dalla variabile della famiglia attiva', () => {
  const env = { LLM_PROVIDER: 'google', MODEL_LABEL_GOOGLE: 'Gemini 3.8 Flash', MODEL_LABEL_ANTHROPIC: 'Claude Opus 4.8' }
  assert.deepEqual(modelInfo(env), { provider: 'google', label: 'Gemini 3.8 Flash' })
  assert.deepEqual(modelInfo({ ...env, LLM_PROVIDER: 'anthropic' }), { provider: 'anthropic', label: 'Claude Opus 4.8' })
})

test('modelInfo: senza variabile usa un nome generico per famiglia; senza LLM_PROVIDER è openai', () => {
  assert.deepEqual(modelInfo({}), { provider: 'openai', label: 'OpenAI GPT' })
  assert.equal(modelInfo({ LLM_PROVIDER: 'google' }).label, 'Google Gemini')
  assert.equal(modelInfo({ LLM_PROVIDER: 'anthropic' }).label, 'Anthropic Claude')
  assert.equal(modelInfo({ LLM_PROVIDER: 'google', MODEL_LABEL_GOOGLE: '   ' }).label, 'Google Gemini')
})

test('modelInfo: famiglia sconosciuta = errore di configurazione', () => {
  assert.throws(() => modelInfo({ LLM_PROVIDER: 'mistral' }), e => e.status === 500 && /mistral/.test(e.message))
})

test('GET del modello: JSON con famiglia e nome; errore di configurazione = 500 senza dettagli interni', async () => {
  const app = express()
  app.get('/ok', createModelHandler({ LLM_PROVIDER: 'google', MODEL_LABEL_GOOGLE: 'Gemini 3.8 Flash' }))
  app.get('/ko', createModelHandler({ LLM_PROVIDER: 'mistral' }))
  app.use(errorHandler)
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  server.unref()
  const base = `http://127.0.0.1:${server.address().port}`
  const ok = await fetch(base + '/ok')
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { provider: 'google', label: 'Gemini 3.8 Flash' })
  const ko = await fetch(base + '/ko')
  assert.equal(ko.status, 500)
  assert.ok((await ko.json()).error.message)
  server.close()
})
