export type HoldingInput = {
  folioNumber: string
  schemeName: string
  amfiCode: string
  units: number
  nav: number
  valuationDate: string // e.g. "31-Mar-2026"
  purCost: number
  marketValue: number
  unrealizedGain: number
}
