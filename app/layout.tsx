import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PF Copilot',
  description: 'Personal Finance Copilot for Indian retail investors — educational tool only',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
