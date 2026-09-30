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

  const images = []
  for (let i = 0; i < Math.min(pages, MAX_IMAGE_PAGES); i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true)
    images.push(Buffer.from(pix.asPNG()))
  }
  return { text: '', images }
}

module.exports = { extractContent }
