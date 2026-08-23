import type { Metadata } from 'next'
import './globals.css'
import NavBar from '@/components/nav-bar'

export const metadata: Metadata = {
  title: 'PF Copilot',
  description: 'Personal Finance Copilot for Indian retail investors — educational tool only',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  )
}
