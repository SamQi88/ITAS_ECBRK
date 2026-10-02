const { modelInfo } = require('./lib/config')

// GET /api/model: famiglia e nome del modello attivo, per mostrarlo nella pagina
function createModelHandler (env = process.env) {
  return (req, res, next) => {
    try { res.json(modelInfo(env)) } catch (e) { next(e) }
  }
}

module.exports = { createModelHandler }
