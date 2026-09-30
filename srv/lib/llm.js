const { HttpError } = require('./errors')

const SYSTEM_PROMPT = `Sei un assistente che estrae dati da rendiconti provvigionali assicurativi italiani.
Il documento contiene una tabella con una riga per ogni polizza/titolo.
Rispondi SOLO con un oggetto JSON di questa forma:
{"righe":[{"dataEffetto":"gg/mm/aaaa","contraente":"...","numeroPolizza":"...","premi":"...","provvigioni":"...","dataIncasso":"gg/mm/aaaa"}]}

Regole:
- Una voce per ogni riga di polizza, nell'ordine del documento. Non includere righe di totale, saldo o riporto.
- dataEffetto: colonna "Data Effetto"; se assente usa "Dec.Rata".
- contraente: colonna "Cliente" oppure "Contraente".
- numeroPolizza: colonna "Nro Contratto" (se il valore è ripetuto dopo "||" tieni solo il primo) oppure "Polizza".
- premi: "Premio Lordo" oppure "Premi" della riga, non il totale.
- provvigioni: "Provvigioni Attive Totali" oppure "Provvigioni" della riga, prima della ritenuta, non il totale.
- dataIncasso: colonna "Data Incasso" / "Data incasso".
- Copia importi e date come sono scritti nel documento. Se un valore manca usa null. Non inventare valori.`

function parseModelJson (content) {
  const s = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(s) } catch { throw new HttpError(502, 'Risposta del modello non valida', 'BAD_MODEL_RESPONSE') }
}

function createLlmClient ({ config, fetchImpl = fetch }) {
  let token, tokenExp = 0

  async function getToken () {
    if (token && Date.now() < tokenExp) return token
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const res = await fetchImpl(`${config.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    })
    if (!res.ok) throw new Error(`token HTTP ${res.status}`)
    const body = await res.json()
    token = body.access_token
    tokenExp = Date.now() + (body.expires_in - 60) * 1000
    return token
  }

  async function extractPolicies ({ text, images }) {
    const userContent = images && images.length
      ? [{ type: 'text', text: 'Estrai le righe di polizza dalle pagine allegate.' },
         ...images.map(b => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from(b).toString('base64') } }))]
      : `Estrai le righe di polizza dal seguente testo del documento:\n\n${text}`
    let data
    try {
      const res = await fetchImpl(
        `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/chat/completions?api-version=${config.apiVersion}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await getToken()}`, 'AI-Resource-Group': config.resourceGroup, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
            response_format: { type: 'json_object' },
            max_completion_tokens: 16000
          })
        })
      if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${await res.text()}`)
      data = await res.json()
    } catch (err) {
      console.error('[llm]', err.message)
      throw new HttpError(502, 'Servizio di estrazione non disponibile', 'LLM_UNAVAILABLE')
    }
    return parseModelJson(data.choices?.[0]?.message?.content)
  }

  return { extractPolicies }
}

module.exports = { createLlmClient }
