import React from 'react'

export interface ComparisonReportData {
  overlapAnalysis: {
    overlapPercentage: number
    sharedFunds: string[]
    newFunds: string[]
    exitFunds: string[]
  }
  costAnalysis: {
    currentWeightedExpenseRatio: number
    recommendedWeightedExpenseRatio: number
    annualSavingsEstimate: number
  }
  returnAnalysis: {
    currentPortfolio3YrReturn: number
    recommendedPortfolio3YrReturn: number
    alphaVsBenchmark: number
  }
  consolidationInsight: string
  switchingCost: {
    estimatedExitLoad: number
    shortTermCapitalGainsTaxEstimate: number
    longTermCapitalGainsTaxEstimate: number
    qualitativeFriction: string
  }
}

export function ComparisonReport({ data }: { data: ComparisonReportData }) {
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-xl font-semibold mb-4 text-zinc-900 dark:text-zinc-100">Why this recommendation?</h3>
        <p className="text-zinc-600 dark:text-zinc-400 mb-6">{data.consolidationInsight}</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
            <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-3">Portfolio Returns (3Y)</h4>
            <div className="flex justify-between items-center mb-2">
              <span className="text-zinc-500 dark:text-zinc-400 text-sm">Current</span>
              <span className="font-medium">{(data.returnAnalysis.currentPortfolio3YrReturn * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-zinc-500 dark:text-zinc-400 text-sm">Recommended</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{(data.returnAnalysis.recommendedPortfolio3YrReturn * 100).toFixed(2)}%</span>
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
              <span className="text-sm font-medium">Expected Alpha</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">+{data.returnAnalysis.alphaVsBenchmark.toFixed(2)}%</span>
            </div>
          </div>

          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
            <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-3">Cost Analysis</h4>
            <div className="flex justify-between items-center mb-2">
              <span className="text-zinc-500 dark:text-zinc-400 text-sm">Current Expense Ratio</span>
              <span className="font-medium">{(data.costAnalysis.currentWeightedExpenseRatio * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-zinc-500 dark:text-zinc-400 text-sm">Recommended Expense Ratio</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{(data.costAnalysis.recommendedWeightedExpenseRatio * 100).toFixed(2)}%</span>
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
              <span className="text-sm font-medium">Est. Annual Savings</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">₹{data.costAnalysis.annualSavingsEstimate.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-zinc-100">Portfolio Overlap &amp; Changes</h3>
        
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-500 dark:text-zinc-400">Portfolio Overlap</span>
            <span className="font-medium">{Math.round(data.overlapAnalysis.overlapPercentage * 100)}%</span>
          </div>
          <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full" 
              style={{ width: `${Math.min(100, Math.max(0, data.overlapAnalysis.overlapPercentage * 100))}%` }}
            ></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 mb-2 flex items-center">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
              New Funds to Add
            </h4>
            <ul className="space-y-1">
              {data.overlapAnalysis.newFunds.length > 0 ? data.overlapAnalysis.newFunds.map((fund, i) => (
                <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400 border-l-2 border-emerald-500/30 pl-2 py-1">{fund}</li>
              )) : <li className="text-sm text-zinc-500 italic">No new funds</li>}
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 mb-2 flex items-center">
              <span className="w-2 h-2 rounded-full bg-rose-500 mr-2"></span>
              Funds to Exit
            </h4>
            <ul className="space-y-1">
              {data.overlapAnalysis.exitFunds.length > 0 ? data.overlapAnalysis.exitFunds.map((fund, i) => (
                <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400 border-l-2 border-rose-500/30 pl-2 py-1">{fund}</li>
              )) : <li className="text-sm text-zinc-500 italic">No funds to exit</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-zinc-100">Estimated Switching Impact</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Est. Exit Load</p>
            <p className="font-medium text-rose-600 dark:text-rose-400">₹{data.switchingCost.estimatedExitLoad.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">STCG Tax</p>
            <p className="font-medium text-rose-600 dark:text-rose-400">₹{data.switchingCost.shortTermCapitalGainsTaxEstimate.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">LTCG Tax</p>
            <p className="font-medium text-rose-600 dark:text-rose-400">₹{data.switchingCost.longTermCapitalGainsTaxEstimate.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Friction</p>
            <p className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{data.switchingCost.qualitativeFriction}</p>
          </div>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">Note: Taxes and exit loads are estimates based on standard rates and approximate holding periods. Actual values may vary based on exact transaction dates.</p>
      </div>
    </div>
  )
}
