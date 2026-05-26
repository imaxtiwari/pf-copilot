'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { label: 'Onboarding', href: '/onboarding' },
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Upload CAS', href: '/portfolio/upload' },
  { label: 'Chat', href: '/chat' },
] as const

export default function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="bg-gray-900 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        {/* Brand */}
        <Link
          href="/"
          className="mr-4 text-sm font-bold tracking-wide text-white hover:text-indigo-300"
        >
          PF Copilot
        </Link>

        {/* Page links */}
        {NAV_LINKS.map(({ label, href }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={
                isActive
                  ? 'text-sm font-semibold text-indigo-400'
                  : 'text-sm text-gray-300 hover:text-indigo-300'
              }
            >
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
