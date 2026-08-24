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
]

export default config
