const { HttpError } = require('./errors')

const SYSTEM_PROMPT = `Sei un assistente che estrae dati da rendiconti provvigionali assicurativi italiani.
Il documento contiene una tabella con una riga per ogni polizza/titolo.
Rispondi SOLO con un oggetto JSON di questa forma:
{"ritenutaAcconto":"...","totalePremiDocumento":"...","totaleProvvigioniDocumento":"...","righe":[{"dataEffetto":"gg/mm/aaaa","contraente":"...","numeroPolizza":"...","premi":"...","provvigioni":"...","dataIncasso":"gg/mm/aaaa"}]}

Regole:
- ritenutaAcconto: importo complessivo della ritenuta d'acconto (R.d.A.) del documento, di solito vicino ai totali (per esempio "Ritenuta di acconto … EUR" o "Importo R.d.A."). Usa il totale del documento, non la ritenuta di una singola riga. Se nel documento non c'è usa null.
- totalePremiDocumento e totaleProvvigioniDocumento: i totali di premi e di provvigioni stampati nel documento (riga "Totale" o "Totali"). Copia il valore scritto, non calcolarlo sommando le righe. Se il documento non riporta il totale usa null.
- Una voce per ogni riga di polizza, nell'ordine del documento. Non includere righe di totale, saldo o riporto.
- dataEffetto: colonna "Data Effetto"; se assente usa "Dec.Rata" oppure "NS. RIF." o "Data scadenza" .
- contraente: colonna "Cliente" oppure "Contraente".
- numeroPolizza: colonna "Nro Contratto" (se il valore è ripetuto dopo "||" tieni solo il primo) oppure "Polizza".
- premi: "Premio Lordo" oppure "Premi" della riga, non il totale.
- provvigioni: "Provvigioni Attive Totali" oppure "Provvigioni" della riga, prima della ritenuta, non il totale.
- dataIncasso: colonna "Data Incasso" / "Data incasso" oppure solo "Data".
- Copia importi e date come sono scritti nel documento. Se un valore manca usa null. Non inventare valori.`

// il contenuto della risposta contiene dati di clienti: nei log solo metadati
function parseModelJson (content, finishReason, usage) {
  const s = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(s) } catch {}
  // alcuni modelli (Claude) aggiungono testo prima o dopo il JSON: si prova dal primo { all'ultimo }
  const from = s.indexOf('{')
  const to = s.lastIndexOf('}')
  if (from !== -1 && to > from) {
    try { return JSON.parse(s.slice(from, to + 1)) } catch {}
  }
  console.error(`[llm] JSON non valido: finish_reason=${finishReason}, lunghezza=${s.length}, usage=${JSON.stringify(usage)}`)
  throw new HttpError(502, 'Risposta del modello non valida', 'BAD_MODEL_RESPONSE')
}

// un adattatore per famiglia di modelli: costruisce la richiesta e legge la risposta
const PROVIDERS = {
  openai: require('./providers/openai'),
  google: require('./providers/google'),
  anthropic: require('./providers/anthropic')
}

function createLlmClient ({ config, fetchImpl = fetch }) {
  const providerName = config.provider || 'openai'
  const provider = PROVIDERS[providerName]
  if (!provider) throw new HttpError(500, `Famiglia di modelli non supportata: ${providerName}`, 'CONFIG')
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
    const instruction = images && images.length
      ? 'Estrai le righe di polizza dalle pagine allegate.'
      : `Estrai le righe di polizza dal seguente testo del documento:\n\n${text}`
    const { url, body } = provider.buildRequest({ config, system: SYSTEM_PROMPT, instruction, images })
    let data, tokenTime, callMs
    try {
      const tokenFresh = !(token && Date.now() < tokenExp)
      const t0 = Date.now()
      const bearer = await getToken()
      tokenTime = tokenFresh ? `${Date.now() - t0}ms` : 'cache'
      const t1 = Date.now()
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'AI-Resource-Group': config.resourceGroup, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`${providerName} HTTP ${res.status}: ${await res.text()}`)
      data = await res.json()
      callMs = Date.now() - t1
    } catch (err) {
      console.error('[llm]', err.message)
      throw new HttpError(502, 'Servizio di estrazione non disponibile', 'LLM_UNAVAILABLE')
    }
    const { content, finishReason, truncated, usage } = provider.parseResponse(data)
    // solo metadati: il contenuto contiene dati di clienti
    console.log(`[llm] provider=${providerName} deployment=${config.deploymentId} token=${tokenTime} chiamata=${callMs}ms finish=${finishReason}`)
    if (truncated) {
      console.error(`[llm] risposta troncata: finish_reason=${finishReason}, usage=${JSON.stringify(usage)}`)
      throw new HttpError(502, 'Risposta del modello troncata: documento troppo lungo', 'MODEL_TRUNCATED')
    }
    return parseModelJson(content, finishReason, usage)
  }

  return { extractPolicies }
}

module.exports = { createLlmClient }
