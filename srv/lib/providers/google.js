// Google Gemini (Vertex AI) tramite SAP AI Core (generateContent)
const DEFAULT_MAX_OUTPUT_TOKENS = 64000

function buildRequest ({ config, system, instruction, images }) {
  const parts = [{ text: instruction }]
  for (const b of images || []) parts.push({ inlineData: { mimeType: 'image/png', data: Buffer.from(b).toString('base64') } })
  return {
    url: `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/models/${config.model}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      // ragionamento ridotto: dimezza i tempi (16,4 s → 8,6 s su AON) con gli stessi risultati
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: 'low' }
      }
    }
  }
}

function parseResponse (data) {
  const candidate = data.candidates?.[0]
  const parts = candidate?.content?.parts
  // le parti di ragionamento (thought) non fanno parte della risposta
  const text = Array.isArray(parts) ? parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('') : null
  const finishReason = candidate?.finishReason ?? null
  return { content: text || null, finishReason, truncated: finishReason === 'MAX_TOKENS', usage: data.usageMetadata }
}

module.exports = { buildRequest, parseResponse }
