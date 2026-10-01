// Anthropic Claude (AWS Bedrock) tramite SAP AI Core (Converse)
const MAX_OUTPUT_TOKENS = 16000

function buildRequest ({ config, system, instruction, images }) {
  const content = [{ text: instruction }]
  for (const b of images || []) content.push({ image: { format: 'png', source: { bytes: Buffer.from(b).toString('base64') } } })
  return {
    url: `${config.apiUrl}/v2/inference/deployments/${config.deploymentId}/converse`,
    body: {
      system: [{ text: system }],
      messages: [{ role: 'user', content }],
      inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS }
    }
  }
}

function parseResponse (data) {
  const blocks = data.output?.message?.content
  const text = Array.isArray(blocks) ? blocks.filter(c => typeof c.text === 'string').map(c => c.text).join('') : null
  const finishReason = data.stopReason ?? null
  return { content: text || null, finishReason, truncated: finishReason === 'max_tokens', usage: data.usage }
}

module.exports = { buildRequest, parseResponse }
