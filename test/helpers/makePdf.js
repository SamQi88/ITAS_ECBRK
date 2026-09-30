function makePdf (text, pages = 1) {
  const content = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : ''
  const fontNum = 3 + 2 * pages
  const kids = Array.from({ length: pages }, (_, i) => `${3 + 2 * i} 0 R`).join(' ')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`
  ]
  for (let i = 0; i < pages; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 200] /Contents ${4 + 2 * i} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`)
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach(o => { out += `${String(o).padStart(10, '0')} 00000 n \n` })
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
module.exports = { makePdf }
