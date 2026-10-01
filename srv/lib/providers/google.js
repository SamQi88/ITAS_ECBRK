// Google Gemini (Vertex AI) tramite SAP AI Core (generateContent)
const MAX_OUTPUT_TOKENS = 16000

function buildRequest ({ config, system, instruction, images }) {
  const parts = [{ text: instruction }]
  for (const b of images || []) parts.push({ inlineData: { mimeType: 'image/png', data: Buffer.from(b).toString('base64') } })
  return {
    url: `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/models/${config.model}:generateContent`,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_OUTPUT_TOKENS }
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
