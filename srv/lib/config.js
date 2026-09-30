const { HttpError } = require('./errors')

function loadConfig (env = process.env) {
  let creds = {}
  if (env.VCAP_SERVICES) {
    try { creds = (JSON.parse(env.VCAP_SERVICES).aicore || [])[0]?.credentials || {} } catch { creds = {} }
  }
  const cfg = {
    authUrl: env.AI_CORE_AUTH_URL || creds.url,
    clientId: env.AI_CORE_CLIENT_ID || creds.clientid,
    clientSecret: env.AI_CORE_CLIENT_SECRET || creds.clientsecret,
    apiUrl: env.AI_API_URL || creds.serviceurls?.AI_API_URL,
    deploymentId: env.DEPLOYMENT_ID,
    resourceGroup: env.RESOURCE_GROUP || 'default',
    apiVersion: env.AI_API_VERSION || '2024-12-01-preview'
  }
  const names = { authUrl: 'AI_CORE_AUTH_URL', clientId: 'AI_CORE_CLIENT_ID', clientSecret: 'AI_CORE_CLIENT_SECRET', apiUrl: 'AI_API_URL', deploymentId: 'DEPLOYMENT_ID' }
  for (const [k, name] of Object.entries(names)) {
    if (!cfg[k]) throw new HttpError(500, `Configurazione mancante: ${name}`, 'CONFIG')
  }
  return cfg
}

module.exports = { loadConfig }
