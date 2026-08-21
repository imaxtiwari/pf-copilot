import type { Metadata } from 'next'
import './globals.css'
import NavBar from '@/components/nav-bar'

export const metadata: Metadata = {
  title: 'PF Copilot',
  description: 'Personal Finance Copilot for Indian retail investors — educational tool only',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Trigger scheduler startup on the server side (non-blocking)
  if (typeof window === 'undefined') {
    const port = process.env.PORT || 3000
    fetch(`http://localhost:${port}/api/scheduler`).catch((err) => {
      // Silently catch error, expected if server is not fully up or port is different
      console.warn('Scheduler startup trigger fetch failed:', err.message)
    })
  }

  return (
    <html lang="en">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  )
}
