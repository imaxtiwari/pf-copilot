import PDFDocument from 'pdfkit'
import { HoldingInput } from './types'

export async function generateCASPdf(holdings: HoldingInput[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 })
      const chunks: Buffer[] = []

      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err) => reject(err))

      // --- Page 1: Header ---
      doc.fontSize(24).text('Consolidated Account Statement', { align: 'center' })
      doc.moveDown()
      doc.fontSize(12).text('Period: 01-Apr-2025 to 31-Mar-2026', { align: 'center' })
      doc.moveDown(2)

      doc.fontSize(14).text('Investor Details', { underline: true })
      doc.moveDown(0.5)
      doc.fontSize(12)
      doc.text('PAN: XXXXX1234X')
      doc.text('Name: Niti Gupta')
      doc.text('Email: niti.gupta@example.com')
      doc.moveDown(2)

      // --- Page 2+: Holdings ---
      doc.addPage()
      doc.fontSize(18).text('Portfolio Holdings', { align: 'center', underline: true })
      doc.moveDown(2)

      let totalPortfolioValue = 0

      // In a real CAS, holdings are grouped by AMC. Here we'll just list them out.
      for (const h of holdings) {
        doc.fontSize(14).text(`Fund: ${h.schemeName}`, { continued: true })
        doc.fontSize(10).text(`  (AMFI: ${h.amfiCode})`)
        doc.moveDown(0.5)
        
        doc.text(`Folio Number: ${h.folioNumber}`)
        doc.text(`Units: ${h.units}`)
        doc.text(`NAV: ${h.nav}`)
        doc.text(`Valuation Date: ${h.valuationDate}`)
        doc.text(`Purchase Cost: ${h.purCost}`)
        doc.text(`Market Value: ${h.marketValue}`)
        doc.text(`Unrealized Gain: ${h.unrealizedGain}`)
        doc.moveDown(1)

        totalPortfolioValue += h.marketValue
      }

      // --- Last Page: Summary ---
      doc.addPage()
      doc.fontSize(18).text('Summary', { align: 'center', underline: true })
      doc.moveDown(2)
      doc.fontSize(14)
      doc.text(`Total portfolio value: INR ${totalPortfolioValue}`)
      doc.text(`Total number of folios: ${holdings.length}`)

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
