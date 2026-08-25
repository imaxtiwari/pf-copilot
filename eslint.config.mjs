import nextConfig from 'eslint-config-next'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    name: 'pf-copilot/ignores',
    ignores: [
      'coverage/**',
      'sandbox/**',
      'test-results/**',
      'playwright-report/**',
      'db/migrations/**',
      '*.config.js',
      '*.config.ts',
      'next-env.d.ts',
    ],
  },
  {
    name: 'pf-copilot/client-data-fetching',
    // TODO: migrate client "use effect" data fetching to server components + Suspense
    // so these rules can be re-enabled. Until then, initial fetches are a known pattern.
    files: ['app/**/page.tsx', 'components/**/*.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
]

export default config
