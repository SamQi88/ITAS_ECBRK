const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig } = require('../../srv/lib/config')

const BASE = { AI_CORE_CLIENT_ID: 'id', AI_CORE_CLIENT_SECRET: 's', AI_CORE_AUTH_URL: 'https://auth', AI_API_URL: 'https://api' }

test('senza LLM_PROVIDER usa openai con DEPLOYMENT_ID (compatibilità con la configurazione esistente)', () => {
  const c = loadConfig({ ...BASE, DEPLOYMENT_ID: 'd-old' })
  assert.equal(c.provider, 'openai')
  assert.equal(c.deploymentId, 'd-old')
})

test('openai: DEPLOYMENT_ID_OPENAI ha la precedenza su DEPLOYMENT_ID', () => {
  const c = loadConfig({ ...BASE, LLM_PROVIDER: 'openai', DEPLOYMENT_ID: 'd-old', DEPLOYMENT_ID_OPENAI: 'd-new' })
  assert.equal(c.deploymentId, 'd-new')
})

test('google: usa DEPLOYMENT_ID_GOOGLE e GOOGLE_MODEL', () => {
  const c = loadConfig({ ...BASE, LLM_PROVIDER: 'google', DEPLOYMENT_ID_GOOGLE: 'dg', GOOGLE_MODEL: 'gemini-3.8-flash', DEPLOYMENT_ID: 'd-old' })
  assert.equal(c.provider, 'google')
  assert.equal(c.deploymentId, 'dg')
  assert.equal(c.model, 'gemini-3.8-flash')
})

test('anthropic: usa DEPLOYMENT_ID_ANTHROPIC e non quello di openai', () => {
  const c = loadConfig({ ...BASE, LLM_PROVIDER: 'anthropic', DEPLOYMENT_ID_ANTHROPIC: 'da', DEPLOYMENT_ID: 'd-old' })
  assert.equal(c.provider, 'anthropic')
  assert.equal(c.deploymentId, 'da')
})

test('il nome della variabile mancante dipende dalla famiglia scelta', () => {
  assert.throws(() => loadConfig({ ...BASE, LLM_PROVIDER: 'google', GOOGLE_MODEL: 'm' }), e => e.status === 500 && /DEPLOYMENT_ID_GOOGLE/.test(e.message))
  assert.throws(() => loadConfig({ ...BASE, LLM_PROVIDER: 'google', DEPLOYMENT_ID_GOOGLE: 'dg' }), e => e.status === 500 && /GOOGLE_MODEL/.test(e.message))
  assert.throws(() => loadConfig({ ...BASE, LLM_PROVIDER: 'anthropic' }), e => e.status === 500 && /DEPLOYMENT_ID_ANTHROPIC/.test(e.message))
})

test('LLM_PROVIDER sconosciuto: errore che elenca i valori ammessi', () => {
  assert.throws(() => loadConfig({ ...BASE, LLM_PROVIDER: 'mistral', DEPLOYMENT_ID: 'd' }),
    e => e.status === 500 && /openai/.test(e.message) && /google/.test(e.message) && /anthropic/.test(e.message))
})

test('il valore di LLM_PROVIDER ignora maiuscole e spazi', () => {
  assert.equal(loadConfig({ ...BASE, LLM_PROVIDER: ' Anthropic ', DEPLOYMENT_ID_ANTHROPIC: 'da' }).provider, 'anthropic')
})

test('LLM_MAX_OUTPUT_TOKENS: default 64000, valore personalizzato, valori non validi rifiutati', () => {
  assert.equal(loadConfig({ ...BASE, DEPLOYMENT_ID: 'd' }).maxOutputTokens, 64000)
  assert.equal(loadConfig({ ...BASE, DEPLOYMENT_ID: 'd', LLM_MAX_OUTPUT_TOKENS: '32000' }).maxOutputTokens, 32000)
  for (const v of ['abc', '0', '-5', '1.5', '1000000']) {
    assert.throws(() => loadConfig({ ...BASE, DEPLOYMENT_ID: 'd', LLM_MAX_OUTPUT_TOKENS: v }), e => e.status === 500 && /LLM_MAX_OUTPUT_TOKENS/.test(e.message), `valore ${v}`)
  }
})
