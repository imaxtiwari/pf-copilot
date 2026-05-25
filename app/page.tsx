import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-4xl font-bold tracking-tight">PF Copilot</h1>
      <p className="text-gray-500">Personal Finance Copilot for Indian retail investors</p>
      <p className="rounded bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
        Educational tool only — not investment advice.
      </p>
      <Link
        href="/onboarding"
        className="mt-4 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
      >
        Get started →
      </Link>
    </main>
  )
}
