const { HttpError } = require('./errors')

const MIN_CHARS_PER_PAGE = 100
const MAX_IMAGE_PAGES = 10

let mupdfPromise
const loadMupdf = () => (mupdfPromise ||= import('mupdf'))

async function extractContent (buffer) {
  const mupdf = await loadMupdf()
  let doc
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  } catch {
    throw new HttpError(400, 'Il file PDF è danneggiato o non leggibile', 'BAD_PDF')
  }
  if (doc.needsPassword()) throw new HttpError(400, 'Il PDF è protetto da password', 'BAD_PDF')

  const pages = doc.countPages()
  let text = ''
  for (let i = 0; i < pages; i++) {
    text += doc.loadPage(i).toStructuredText('preserve-whitespace').asText() + '\n'
  }
  if (text.trim().length >= MIN_CHARS_PER_PAGE * pages) return { text, images: [] }

  if (pages > MAX_IMAGE_PAGES) {
    throw new HttpError(422, `Il PDF scansionato ha ${pages} pagine: il massimo consentito è ${MAX_IMAGE_PAGES} pagine`, 'TOO_MANY_PAGES')
  }
  const images = []
  for (let i = 0; i < pages; i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true)
    images.push(Buffer.from(pix.asPNG()))
  }
  return { text: '', images }
}

module.exports = { extractContent }
