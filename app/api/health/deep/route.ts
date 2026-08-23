import { NextRequest, NextResponse } from 'next/server'
import { ok, err } from '@/lib/contracts/error-envelope'
import { getGpt4oMini, getEmbedding } from '@/lib/azure-openai'

export type DeepHealthCheckResult = {
    ok: true
    data: {
        status: 'healthy'
        checks: {
            azure_chat: boolean
            azure_embedding: boolean
        }
    }
}

export type DeepHealthCheckError = {
    ok: false
    error: {
        code: string
        message: string
        details?: unknown
        request_id: string
    }
}

const DEEP_TOKEN_ENV = 'HEALTH_DEEP_TOKEN'

function isAuthorized(req: NextRequest): boolean {
    const configured = process.env[DEEP_TOKEN_ENV]
    if (!configured) {
        // When no token is configured, deep health is disabled in production.
        return process.env.NODE_ENV !== 'production'
    }
    const header = req.headers.get('authorization')
    if (!header) return false
    // Support "Bearer <token>" or raw token.
    const token = header.startsWith('Bearer ') ? header.slice(7) : header
    return token === configured
}

/**
 * GET /api/health/deep
 *
 * Deep health check that calls Azure OpenAI chat and embedding endpoints.
 * Protected by the HEALTH_DEEP_TOKEN secret. Intended for manual diagnostics
 * only; do not point load balancers or uptime monitors here.
 */
export async function GET(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json(
            err('unauthorized', 'Deep health check requires a valid Authorization header'),
            { status: 401 },
        )
    }

    const checks = {
        azure_chat: false,
        azure_embedding: false,
    }
    const errors: string[] = []

    try {
        const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI ?? 'gpt-4o-mini'
        const client = getGpt4oMini()
        const response = await client.chat.completions.create({
            model: deployment,
            messages: [{ role: 'user', content: 'respond with OK' }],
            max_tokens: 10,
        })
        if (response.choices[0]?.message?.content) checks.azure_chat = true
    } catch (e) {
        errors.push(`azure_chat: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
        const vector = await getEmbedding('test')
        if (vector.length > 0) checks.azure_embedding = true
    } catch (e) {
        errors.push(`azure_embedding: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (checks.azure_chat && checks.azure_embedding) {
        return NextResponse.json(ok({ status: 'healthy', checks }))
    }

    return NextResponse.json(
        err('health_check_failed', 'One or more deep health checks failed', { checks, errors }),
        { status: 503 },
    )
}
