import '@testing-library/jest-dom/vitest'

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/test'
