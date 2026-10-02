const { test } = require('node:test')
const assert = require('node:assert/strict')
const openai = require('../../srv/lib/providers/openai')
const google = require('../../srv/lib/providers/google')
const anthropic = require('../../srv/lib/providers/anthropic')

const base = { apiUrl: 'https://api', deploymentId: 'd1', apiVersion: 'v1' }
const PNG = Buffer.from('png')
const B64 = PNG.toString('base64')
const SYS = 'istruzioni di sistema'

// ---- OpenAI / Azure
test('openai: URL, corpo con testo e lettura della risposta', () => {
  const { url, body } = openai.buildRequest({ config: base, system: SYS, instruction: 'estrai dal testo X', images: [] })
  assert.equal(url, 'https://api/v2/inference/deployments/d1/chat/completions?api-version=v1')
  assert.deepEqual(body.messages, [{ role: 'system', content: SYS }, { role: 'user', content: 'estrai dal testo X' }])
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.equal(body.max_completion_tokens, 64000)
  assert.equal(body.temperature, undefined)
  assert.equal(body.reasoning_effort, 'low') // meno ragionamento = risposta più veloce, stessa precisione sui nostri PDF
  const r = openai.parseResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: { total_tokens: 5 } })
  assert.deepEqual(r, { content: '{"a":1}', finishReason: 'stop', truncated: false, usage: { total_tokens: 5 } })
})

test('openai: con immagini usa image_url base64; troncamento = finish_reason length', () => {
  const { body } = openai.buildRequest({ config: base, system: SYS, instruction: 'estrai dalle pagine', images: [PNG] })
  const parts = body.messages.at(-1).content
  assert.deepEqual(parts[0], { type: 'text', text: 'estrai dalle pagine' })
  assert.equal(parts[1].image_url.url, 'data:image/png;base64,' + B64)
  assert.equal(openai.parseResponse({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }).truncated, true)
})

// ---- Google Gemini
test('google: URL con modello, istruzioni di sistema, JSON mode e testo', () => {
  const cfg = { ...base, model: 'gemini-3.8-flash' }
  const { url, body } = google.buildRequest({ config: cfg, system: SYS, instruction: 'estrai dal testo X', images: [] })
  assert.equal(url, 'https://api/v2/inference/deployments/d1/models/gemini-3.8-flash:generateContent')
  assert.deepEqual(body.systemInstruction, { parts: [{ text: SYS }] })
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'estrai dal testo X' }] }])
  assert.equal(body.generationConfig.responseMimeType, 'application/json')
  assert.equal(body.generationConfig.maxOutputTokens, 64000)
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' })
})

test('google: con immagini usa inlineData base64', () => {
  const { body } = google.buildRequest({ config: { ...base, model: 'm' }, system: SYS, instruction: 'estrai dalle pagine', images: [PNG] })
  assert.deepEqual(body.contents[0].parts, [{ text: 'estrai dalle pagine' }, { inlineData: { mimeType: 'image/png', data: B64 } }])
})

test('google: legge solo il testo (ignora le parti di ragionamento) e riconosce MAX_TOKENS', () => {
  const data = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ragionamento', thought: true }, { text: '{"a":' }, { text: '1}' }] } }], usageMetadata: { totalTokenCount: 9 } }
  assert.deepEqual(google.parseResponse(data), { content: '{"a":1}', finishReason: 'STOP', truncated: false, usage: { totalTokenCount: 9 } })
  assert.equal(google.parseResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }).truncated, true)
  // risposta senza candidati (per esempio bloccata): contenuto assente, non un errore di lettura
  assert.equal(google.parseResponse({ promptFeedback: { blockReason: 'SAFETY' } }).content, null)
})

// ---- Anthropic Claude su Bedrock (Converse)
test('anthropic: URL converse, system, testo e limite di token', () => {
  const { url, body } = anthropic.buildRequest({ config: base, system: SYS, instruction: 'estrai dal testo X', images: [] })
  assert.equal(url, 'https://api/v2/inference/deployments/d1/converse')
  assert.deepEqual(body.system, [{ text: SYS }])
  assert.deepEqual(body.messages, [{ role: 'user', content: [{ text: 'estrai dal testo X' }] }])
  assert.equal(body.inferenceConfig.maxTokens, 64000)
  assert.equal(body.additionalModelRequestFields, undefined) // Claude non ragiona: nessun parametro da ridurre
})

test('anthropic: con immagini usa image/format png con byte base64', () => {
  const { body } = anthropic.buildRequest({ config: base, system: SYS, instruction: 'estrai dalle pagine', images: [PNG] })
  assert.deepEqual(body.messages[0].content, [{ text: 'estrai dalle pagine' }, { image: { format: 'png', source: { bytes: B64 } } }])
})

test('anthropic: legge il testo e riconosce max_tokens', () => {
  const data = { output: { message: { role: 'assistant', content: [{ text: '{"a":' }, { text: '1}' }] } }, stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 4 } }
  assert.deepEqual(anthropic.parseResponse(data), { content: '{"a":1}', finishReason: 'end_turn', truncated: false, usage: { inputTokens: 3, outputTokens: 4 } })
  assert.equal(anthropic.parseResponse({ output: { message: { content: [{ text: '{' }] } }, stopReason: 'max_tokens' }).truncated, true)
  assert.equal(anthropic.parseResponse({}).content, null)
})

// ---- limite di token della risposta (documenti molto lunghi)
test('limite di token: 64000 di default per tutte le famiglie, modificabile dalla configurazione', () => {
  const args = { system: SYS, instruction: 'x', images: [] }
  assert.equal(openai.buildRequest({ config: { ...base }, ...args }).body.max_completion_tokens, 64000)
  assert.equal(google.buildRequest({ config: { ...base, model: 'm' }, ...args }).body.generationConfig.maxOutputTokens, 64000)
  assert.equal(anthropic.buildRequest({ config: { ...base }, ...args }).body.inferenceConfig.maxTokens, 64000)
  assert.equal(openai.buildRequest({ config: { ...base, maxOutputTokens: 1234 }, ...args }).body.max_completion_tokens, 1234)
  assert.equal(google.buildRequest({ config: { ...base, model: 'm', maxOutputTokens: 1234 }, ...args }).body.generationConfig.maxOutputTokens, 1234)
  assert.equal(anthropic.buildRequest({ config: { ...base, maxOutputTokens: 1234 }, ...args }).body.inferenceConfig.maxTokens, 1234)
})
