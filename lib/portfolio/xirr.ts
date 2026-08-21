export type CashFlow = {
    date: Date
    amount: number // positive = inflow to investor, negative = outflow from investor
}

function daysBetween(start: Date, end: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000
    return (end.getTime() - start.getTime()) / msPerDay
}

function npv(rate: number, flows: CashFlow[], baseDate: Date): number {
    return flows.reduce((sum, flow) => {
        const days = daysBetween(baseDate, flow.date)
        return sum + flow.amount / Math.pow(1 + rate, days / 365)
    }, 0)
}

function npvDerivative(rate: number, flows: CashFlow[], baseDate: Date): number {
    return flows.reduce((sum, flow) => {
        const days = daysBetween(baseDate, flow.date)
        const factor = Math.pow(1 + rate, days / 365)
        return sum - (flow.amount * days) / (365 * factor * (1 + rate))
    }, 0)
}

export function computeXIRR(flows: CashFlow[]): number | null {
    if (flows.length < 2) return null

    const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime())
    const baseDate = sorted[0].date

    // Quick check: if NPV is zero at rate 0, all flows sum to zero
    const zeroNpv = npv(0, sorted, baseDate)
    if (Math.abs(zeroNpv) < 1e-9) return 0

    let rate = 0.1
    for (let i = 0; i < 100; i++) {
        const value = npv(rate, sorted, baseDate)
        const derivative = npvDerivative(rate, sorted, baseDate)

        if (Math.abs(value) < 1e-9) return Math.round(rate * 10000) / 10000
        if (Math.abs(derivative) < 1e-12) break

        const nextRate = rate - value / derivative
        if (Math.abs(nextRate - rate) < 1e-9) return Math.round(nextRate * 10000) / 10000
        rate = nextRate
    }

    return null
}

export function computePortfolioXIRR(
    snapshots: { asOfDate: string; totalValue: number }[],
    transactions: CashFlow[] = [],
): number | null {
    if (snapshots.length < 2) return null

    const sortedSnapshots = [...snapshots].sort(
        (a, b) => new Date(a.asOfDate).getTime() - new Date(b.asOfDate).getTime(),
    )

    const flows: CashFlow[] = []

    // Initial investment outflow: negative of first snapshot value
    flows.push({
        date: new Date(sortedSnapshots[0].asOfDate),
        amount: -sortedSnapshots[0].totalValue,
    })

    // Any explicit transactions
    flows.push(...transactions)

    // Final redemption inflow: positive last snapshot value
    const last = sortedSnapshots[sortedSnapshots.length - 1]
    flows.push({
        date: new Date(last.asOfDate),
        amount: last.totalValue,
    })

    return computeXIRR(flows)
}
