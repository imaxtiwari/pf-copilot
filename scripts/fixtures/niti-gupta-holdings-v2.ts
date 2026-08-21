import { HoldingInput } from './types'

export const nitiGuptaHoldingsV2: HoldingInput[] = [
  {
    folioNumber: '1234567/89',
    schemeName: 'Axis Bluechip Fund - Direct Plan - Growth',
    amfiCode: '120503',
    units: 884.301, // +42 units
    nav: 59.1, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 40800,
    marketValue: 52262,
    unrealizedGain: 11462
  },
  {
    folioNumber: '1234567/90',
    schemeName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth',
    amfiCode: '118989',
    units: 1203.712,
    nav: 104.2, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 98200,
    marketValue: 125426,
    unrealizedGain: 27226
  },
  {
    folioNumber: '1234568/01',
    schemeName: 'Axis Midcap Fund - Direct Plan - Growth',
    amfiCode: '120841',
    units: 634.201,
    nav: 92.1, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 48100,
    marketValue: 58409,
    unrealizedGain: 10309
  },
  {
    folioNumber: '1234568/02',
    schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    amfiCode: '122639',
    units: 389.102,
    nav: 76.5, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 24100,
    marketValue: 29766,
    unrealizedGain: 5666
  },
  {
    folioNumber: '1234568/03',
    schemeName: 'Axis Small Cap Fund - Direct Plan - Growth',
    amfiCode: '128102',
    units: 550.803, // +38 units
    nav: 45.2, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 21400,
    marketValue: 24896,
    unrealizedGain: 3496
  },
  {
    folioNumber: '1234568/04',
    schemeName: 'SBI Liquid Fund - Direct Plan - Growth',
    amfiCode: '119062',
    units: 99.601, // -25 units
    nav: 3950.4, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 350000,
    marketValue: 393463,
    unrealizedGain: 43463
  },
  {
    folioNumber: '1234568/05',
    schemeName: 'Nippon India Small Cap Fund - Direct Plan - Growth',
    amfiCode: '118778',
    units: 723.401,
    nav: 64.1, // slightly higher
    valuationDate: '30-Jun-2026',
    purCost: 38200,
    marketValue: 46369,
    unrealizedGain: 8169
  },
  { // NEW
    folioNumber: '1234568/06',
    schemeName: 'Mirae Asset ELSS Tax Saver — Direct Growth',
    amfiCode: '118701',
    units: 124.301,
    nav: 38.2,
    valuationDate: '30-Jun-2026',
    purCost: 47000,
    marketValue: 47483,
    unrealizedGain: 483
  }
]

export const nitiGuptaTotalValueV2 = 778074 // sum of all marketValue
