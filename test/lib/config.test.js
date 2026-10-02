const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig } = require('../../srv/lib/config')

test('legge dalle variabili d\'ambiente', () => {
  const c = loadConfig({
    AI_CORE_CLIENT_ID: 'id', AI_CORE_CLIENT_SECRET: 's', AI_CORE_AUTH_URL: 'https://auth',
    AI_API_URL: 'https://api', DEPLOYMENT_ID: 'd1'
  })
  assert.deepEqual(c, { authUrl: 'https://auth', clientId: 'id', clientSecret: 's', apiUrl: 'https://api', deploymentId: 'd1', resourceGroup: 'default', apiVersion: '2024-12-01-preview', provider: 'openai', maxOutputTokens: 64000 })
})

test('legge dal binding VCAP_SERVICES', () => {
  const c = loadConfig({
    DEPLOYMENT_ID: 'd1', RESOURCE_GROUP: 'rg',
    VCAP_SERVICES: JSON.stringify({ aicore: [{ credentials: { clientid: 'id', clientsecret: 's', url: 'https://auth', serviceurls: { AI_API_URL: 'https://api' } } }] })
  })
  assert.equal(c.clientId, 'id')
  assert.equal(c.apiUrl, 'https://api')
  assert.equal(c.resourceGroup, 'rg')
})

test('segnala la variabile mancante', () => {
  assert.throws(() => loadConfig({ AI_CORE_CLIENT_ID: 'id' }), e => e.status === 500 && /AI_CORE_AUTH_URL/.test(e.message))
  const tutteTranneDeployment = { AI_CORE_CLIENT_ID: 'id', AI_CORE_CLIENT_SECRET: 's', AI_CORE_AUTH_URL: 'u', AI_API_URL: 'a' }
  assert.throws(() => loadConfig(tutteTranneDeployment), e => e.status === 500 && /DEPLOYMENT_ID/.test(e.message))
})
