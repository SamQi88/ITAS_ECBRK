// OpenAI / Azure OpenAI tramite SAP AI Core (chat completions)
const MAX_OUTPUT_TOKENS = 16000

function buildRequest ({ config, system, instruction, images }) {
  const userContent = images && images.length
    ? [{ type: 'text', text: instruction },
       ...images.map(b => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + Buffer.from(b).toString('base64') } }))]
    : instruction
  return {
    url: `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/chat/completions?api-version=${config.apiVersion}`,
    // niente `temperature`: i modelli GPT-5 accettano solo il valore di default
    body: {
      messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
      response_format: { type: 'json_object' },
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      // ragionamento ridotto: dimezza i tempi (11,6 s → 5,9 s su AON) con gli stessi risultati; 'minimal' non è supportato
      reasoning_effort: 'low'
    }
  }
}

function parseResponse (data) {
  const choice = data.choices?.[0]
  const finishReason = choice?.finish_reason ?? null
  return { content: choice?.message?.content ?? null, finishReason, truncated: finishReason === 'length', usage: data.usage }
}

module.exports = { buildRequest, parseResponse }
