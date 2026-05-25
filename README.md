# PF Copilot

Personal Finance Copilot for Indian retail investors. Educational tool — NOT investment advice.

## Setup

```bash
cp .env.example .env.local
# fill in your Azure OpenAI credentials and DATABASE_URL
npm install
```

## Local Postgres (pgvector)

```bash
docker run --name pf-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d ankane/pgvector

docker exec -it pf-pg psql -U postgres -c "CREATE DATABASE pf_copilot;"
```

## Dev

```bash
npm run dev       # http://localhost:3000
```

## Health check

```
GET /api/health
```

Returns `{ ok: true, data: { db, azure_chat, azure_embedding, region } }` when all systems are up.

## Stack

Next.js 16 · TypeScript · Tailwind CSS · PostgreSQL 16 + pgvector · Drizzle ORM · Azure OpenAI · pino · zod · vitest · playwright

See `CLAUDE.md` for full constraints and conventions.
