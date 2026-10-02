const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const { createLlmClient } = require('../../srv/lib/llm')

const common = { authUrl: 'https://auth', clientId: 'id', clientSecret: 's', apiUrl: 'https://api', resourceGroup: 'default', apiVersion: 'v1' }
const google = { ...common, provider: 'google', deploymentId: 'dg', model: 'gemini-3.8-flash' }
const anthropic = { ...common, provider: 'anthropic', deploymentId: 'da' }

function fakeFetch (reply) {
  const calls = []
  const f = async (url, opts) => {
    calls.push({ url: String(url), opts })
    if (String(url).includes('/oauth/token')) return json(200, { access_token: 'tok', expires_in: 3600 })
    return reply(url, opts)
  }
  f.calls = calls
  return f
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const gemini = (text, finishReason = 'STOP') => json(200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] })
const claude = (text, stopReason = 'end_turn') => json(200, { output: { message: { role: 'assistant', content: [{ text }] } }, stopReason })
const callOf = f => f.calls.find(c => !c.url.includes('/oauth/token'))
const quiet = () => mock.method(console, 'error', () => {})

test('google: chiama generateContent con token e resource group e restituisce il JSON', async () => {
  const f = fakeFetch(() => gemini('{"righe":[{"numeroPolizza":"P1"}]}'))
  const r = await createLlmClient({ config: google, fetchImpl: f }).extractPolicies({ text: 'testo pdf', images: [] })
  assert.deepEqual(r, { righe: [{ numeroPolizza: 'P1' }] })
  const c = callOf(f)
  assert.equal(c.url, 'https://api/v2/inference/deployments/dg/models/gemini-3.8-flash:generateContent')
  assert.equal(c.opts.headers.Authorization, 'Bearer tok')
  assert.equal(c.opts.headers['AI-Resource-Group'], 'default')
  const body = JSON.parse(c.opts.body)
  assert.match(body.contents[0].parts[0].text, /testo pdf/)
  assert.match(body.systemInstruction.parts[0].text, /righe/)
})

test('anthropic: chiama converse e restituisce il JSON', async () => {
  const f = fakeFetch(() => claude('{"righe":[]}'))
  const r = await createLlmClient({ config: anthropic, fetchImpl: f }).extractPolicies({ text: '', images: [Buffer.from('png')] })
  assert.deepEqual(r, { righe: [] })
  const c = callOf(f)
  assert.equal(c.url, 'https://api/v2/inference/deployments/da/converse')
  assert.equal(JSON.parse(c.opts.body).messages[0].content[1].image.format, 'png')
})

test('senza provider nella configurazione usa openai (come prima)', async () => {
  const f = fakeFetch(() => json(200, { choices: [{ finish_reason: 'stop', message: { content: '{"righe":[]}' } }] }))
  await createLlmClient({ config: { ...common, deploymentId: 'd1' }, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  assert.match(callOf(f).url, /\/d1\/chat\/completions/)
})

test('risposta troncata su google e anthropic: 502 con log che indica il motivo, senza il contenuto', async () => {
  for (const [config, reply, motivo] of [
    [google, () => gemini('{"righe":[{"contraente":"DATO SENSIBILE', 'MAX_TOKENS'), /MAX_TOKENS/],
    [anthropic, () => claude('{"righe":[{"contraente":"DATO SENSIBILE', 'max_tokens'), /max_tokens/]
  ]) {
    const log = quiet()
    try {
      await assert.rejects(createLlmClient({ config, fetchImpl: fakeFetch(reply) }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
      const out = log.mock.calls.map(c => c.arguments.join(' ')).join(' | ')
      assert.match(out, motivo)
      assert.doesNotMatch(out, /DATO SENSIBILE/)
    } finally { log.mock.restore() }
  }
})

test('risposta senza contenuto (per esempio bloccata): 502 con log, non un errore di lettura', async () => {
  const log = quiet()
  try {
    const blocked = fakeFetch(() => json(200, { promptFeedback: { blockReason: 'SAFETY' } }))
    await assert.rejects(createLlmClient({ config: google, fetchImpl: blocked }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
    assert.ok(log.mock.calls.length > 0)
  } finally { log.mock.restore() }
})

test('JSON dentro un testo (tipico di Claude) viene estratto', async () => {
  const f = fakeFetch(() => claude('Ecco il risultato:\n{"righe":[{"numeroPolizza":"P9"}]}\nSpero sia utile.'))
  const r = await createLlmClient({ config: anthropic, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  assert.deepEqual(r, { righe: [{ numeroPolizza: 'P9' }] })
})

test('il token OAuth è condiviso e in cache anche con google e anthropic', async () => {
  const f = fakeFetch(() => gemini('{"righe":[]}'))
  const c = createLlmClient({ config: google, fetchImpl: f })
  await c.extractPolicies({ text: 'a', images: [] })
  await c.extractPolicies({ text: 'b', images: [] })
  assert.equal(f.calls.filter(x => x.url.includes('/oauth/token')).length, 1)
})

test('il prompt chiede anche l\'importo complessivo della ritenuta d\'acconto', async () => {
  const f = fakeFetch(() => gemini('{"righe":[]}'))
  await createLlmClient({ config: google, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  const system = JSON.parse(callOf(f).opts.body).systemInstruction.parts[0].text
  assert.match(system, /ritenutaAcconto/)
  assert.match(system, /null/)
})

test('il prompt chiede di copiare i totali stampati nel documento, senza calcolarli', async () => {
  const f = fakeFetch(() => gemini('{"righe":[]}'))
  await createLlmClient({ config: google, fetchImpl: f }).extractPolicies({ text: 'x', images: [] })
  const system = JSON.parse(callOf(f).opts.body).systemInstruction.parts[0].text
  assert.match(system, /totalePremiDocumento/)
  assert.match(system, /totaleProvvigioniDocumento/)
  assert.match(system, /non calcolar/i)
})

test('log dei tempi: famiglia, deployment, durata di token e chiamata; mai il contenuto', async () => {
  const log = mock.method(console, 'log', () => {})
  try {
    const f = fakeFetch(() => gemini('{"righe":[{"contraente":"DATO SENSIBILE"}]}'))
    const c = createLlmClient({ config: google, fetchImpl: f })
    await c.extractPolicies({ text: 'x', images: [] })
    await c.extractPolicies({ text: 'y', images: [] })
    const lines = log.mock.calls.map(x => x.arguments.join(' '))
    assert.equal(lines.length, 2)
    assert.match(lines[0], /\[llm\] provider=google deployment=dg token=\d+ms chiamata=\d+ms finish=STOP/)
    assert.match(lines[1], /token=cache/)
    assert.doesNotMatch(lines.join('\n'), /DATO SENSIBILE/)
  } finally { log.mock.restore() }
})

test('famiglia sconosciuta nella configurazione: errore 500 chiaro', () => {
  assert.throws(() => createLlmClient({ config: { ...common, provider: 'mistral', deploymentId: 'd' }, fetchImpl: fakeFetch(() => null) }), e => e.status === 500 && /mistral/.test(e.message))
})

test('errore di rete con causa (per esempio timeout): il log riporta il codice della causa', async () => {
  const log = quiet()
  try {
    const timeout = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }) }
    await assert.rejects(createLlmClient({ config: google, fetchImpl: timeout }).extractPolicies({ text: 'x', images: [] }), e => e.status === 502)
    assert.match(log.mock.calls.map(c => c.arguments.join(' ')).join(' | '), /UND_ERR_HEADERS_TIMEOUT/)
  } finally { log.mock.restore() }
})
