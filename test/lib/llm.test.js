const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const { createLlmClient } = require('../../srv/lib/llm')

const config = { authUrl: 'https://auth', clientId: 'id', clientSecret: 's', apiUrl: 'https://api', deploymentId: 'd1', resourceGroup: 'default', apiVersion: 'v1' }

function fakeFetch (handlers) {
  const calls = []
  const f = async (url, opts) => {
    calls.push({ url: String(url), opts })
    const h = handlers.find(x => String(url).includes(x.match))
    return h.reply(url, opts)
  }
  f.calls = calls
  return f
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const auth = { match: '/oauth/token', reply: () => json(200, { access_token: 'tok', expires_in: 3600 }) }
const chat = content => ({ match: '/chat/completions', reply: () => json(200, { choices: [{ message: { content } }] }) })

test('invia il testo, usa il token e restituisce il JSON', async () => {
  const f = fakeFetch([auth, chat('{"righe":[{"numeroPolizza":"P1"}]}')])
  const r = await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'testo pdf', images: [] })
  assert.deepEqual(r, { righe: [{ numeroPolizza: 'P1' }] })
  const call = f.calls.find(c => c.url.includes('/chat/completions'))
  assert.equal(call.url, 'https://api/v2/inference/deployments/d1/chat/completions?api-version=v1')
  assert.equal(call.opts.headers.Authorization, 'Bearer tok')
  assert.equal(call.opts.headers['AI-Resource-Group'], 'default')
  const body = JSON.parse(call.opts.body)
  assert.equal(body.temperature, undefined)
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.match(body.messages.at(-1).content, /testo pdf/)
})

test('con immagini invia image_url base64', async () => {
  const f = fakeFetch([auth, chat('{"righe":[]}')])
  await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: '', images: [Buffer.from('png')] })
  const body = JSON.parse(f.calls.find(c => c.url.includes('/chat/completions')).opts.body)
  const part = body.messages.at(-1).content.find(p => p.type === 'image_url')
  assert.equal(part.image_url.url, 'data:image/png;base64,' + Buffer.from('png').toString('base64'))
})

test('accetta JSON dentro fence markdown', async () => {
  const f = fakeFetch([auth, chat('```json\n{"righe":[]}\n```')])
  const r = await createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  assert.deepEqual(r, { righe: [] })
})

test('il token è in cache tra due chiamate', async () => {
  const f = fakeFetch([auth, chat('{"righe":[]}')])
  const c = createLlmClient({ config, fetchImpl: f })
  await c.extractPolicies({ text: 'a', images: [] })
  await c.extractPolicies({ text: 'b', images: [] })
  assert.equal(f.calls.filter(x => x.url.includes('/oauth/token')).length, 1)
})

test('HTTP non 2xx, JSON non valido e rete giù danno 502', async () => {
  const bad = fakeFetch([auth, { match: '/chat/completions', reply: () => json(500, {}) }])
  await assert.rejects(createLlmClient({ config, fetchImpl: bad }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
  const notJson = fakeFetch([auth, chat('ciao')])
  await assert.rejects(createLlmClient({ config, fetchImpl: notJson }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
  const down = async () => { throw new Error('ECONNREFUSED') }
  await assert.rejects(createLlmClient({ config, fetchImpl: down }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
})

test('risposta troncata (finish_reason length): 502 e log diagnostico senza il contenuto', async () => {
  const f = fakeFetch([auth, { match: '/chat/completions', reply: () => json(200, { choices: [{ finish_reason: 'length', message: { content: '{"righe":[{"contraente":"DATO SENSIBILE' } }], usage: { completion_tokens: 16000 } }) }])
  const log = mock.method(console, 'error', () => {})
  try {
    await assert.rejects(createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
    const out = log.mock.calls.map(c => c.arguments.join(' ')).join(' | ')
    assert.match(out, /length/)
    assert.doesNotMatch(out, /DATO SENSIBILE/)
  } finally { log.mock.restore() }
})

test('JSON non valido: 502 e log con lunghezza e finish_reason, senza il contenuto', async () => {
  const f = fakeFetch([auth, { match: '/chat/completions', reply: () => json(200, { choices: [{ finish_reason: 'stop', message: { content: 'DATO SENSIBILE non json' } }] }) }])
  const log = mock.method(console, 'error', () => {})
  try {
    await assert.rejects(createLlmClient({ config, fetchImpl: f }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
    const out = log.mock.calls.map(c => c.arguments.join(' ')).join(' | ')
    assert.match(out, /stop/)
    assert.doesNotMatch(out, /DATO SENSIBILE/)
  } finally { log.mock.restore() }
})
