const { HttpError } = require('./errors')

const PROVIDERS = ['openai', 'google', 'anthropic']

function loadConfig (env = process.env) {
  let creds = {}
  if (env.VCAP_SERVICES) {
    try { creds = (JSON.parse(env.VCAP_SERVICES).aicore || [])[0]?.credentials || {} } catch { creds = {} }
  }

  const provider = String(env.LLM_PROVIDER || 'openai').trim().toLowerCase()
  if (!PROVIDERS.includes(provider)) {
    throw new HttpError(500, `LLM_PROVIDER non valido: "${env.LLM_PROVIDER}". Valori ammessi: ${PROVIDERS.join(', ')}`, 'CONFIG')
  }

  // un deployment per famiglia: per cambiare modello basta cambiare LLM_PROVIDER
  const deploymentVar = { openai: 'DEPLOYMENT_ID_OPENAI', google: 'DEPLOYMENT_ID_GOOGLE', anthropic: 'DEPLOYMENT_ID_ANTHROPIC' }[provider]
  const cfg = {
    authUrl: env.AI_CORE_AUTH_URL || creds.url,
    clientId: env.AI_CORE_CLIENT_ID || creds.clientid,
    clientSecret: env.AI_CORE_CLIENT_SECRET || creds.clientsecret,
    apiUrl: env.AI_API_URL || creds.serviceurls?.AI_API_URL,
    // DEPLOYMENT_ID resta valido per openai: è il nome usato prima del supporto a più famiglie
    deploymentId: env[deploymentVar] || (provider === 'openai' ? env.DEPLOYMENT_ID : undefined),
    resourceGroup: env.RESOURCE_GROUP || 'default',
    apiVersion: env.AI_API_VERSION || '2024-12-01-preview',
    provider
  }
  const required = {
    authUrl: 'AI_CORE_AUTH_URL',
    clientId: 'AI_CORE_CLIENT_ID',
    clientSecret: 'AI_CORE_CLIENT_SECRET',
    apiUrl: 'AI_API_URL',
    deploymentId: provider === 'openai' ? 'DEPLOYMENT_ID_OPENAI (o DEPLOYMENT_ID)' : deploymentVar
  }
  for (const [k, name] of Object.entries(required)) {
    if (!cfg[k]) throw new HttpError(500, `Configurazione mancante: ${name}`, 'CONFIG')
  }

  // l'URL di Gemini contiene il nome del modello
  if (provider === 'google') {
    if (!env.GOOGLE_MODEL) throw new HttpError(500, 'Configurazione mancante: GOOGLE_MODEL', 'CONFIG')
    cfg.model = env.GOOGLE_MODEL
  }
  return cfg
}

// nome del modello in linguaggio naturale da mostrare all'utente (non richiede le credenziali di AI Core)
const GENERIC_LABELS = { openai: 'OpenAI GPT', google: 'Google Gemini', anthropic: 'Anthropic Claude' }

function modelInfo (env = process.env) {
  const provider = String(env.LLM_PROVIDER || 'openai').trim().toLowerCase()
  if (!PROVIDERS.includes(provider)) {
    throw new HttpError(500, `LLM_PROVIDER non valido: "${env.LLM_PROVIDER}". Valori ammessi: ${PROVIDERS.join(', ')}`, 'CONFIG')
  }
  const custom = String(env[`MODEL_LABEL_${provider.toUpperCase()}`] || '').trim()
  return { provider, label: custom || GENERIC_LABELS[provider] }
}

module.exports = { loadConfig, modelInfo, PROVIDERS }
