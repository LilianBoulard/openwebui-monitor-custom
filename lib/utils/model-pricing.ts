const LITELLM_PRICES_URL =
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const FETCH_ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 15000
// The upstream list has thousands of entries; far fewer means a bad payload
const MIN_EXPECTED_ENTRIES = 100

export interface ModelPricing {
    input_price: number
    output_price: number
}

async function fetchPricingList(): Promise<Map<string, ModelPricing>> {
    let lastError: unknown
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(LITELLM_PRICES_URL, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                cache: 'no-store',
            })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const data = (await response.json()) as Record<
                string,
                {
                    input_cost_per_token?: unknown
                    output_cost_per_token?: unknown
                }
            >

            const pricing = new Map<string, ModelPricing>()
            for (const [model, spec] of Object.entries(data)) {
                if (model === 'sample_spec' || !spec) {
                    continue
                }
                const input = spec.input_cost_per_token
                const output = spec.output_cost_per_token
                if (
                    typeof input !== 'number' ||
                    typeof output !== 'number' ||
                    !Number.isFinite(input) ||
                    !Number.isFinite(output) ||
                    input < 0 ||
                    output < 0
                ) {
                    continue
                }
                // LiteLLM lists USD per token; we store USD per million tokens
                pricing.set(model, {
                    input_price: input * 1_000_000,
                    output_price: output * 1_000_000,
                })
            }

            if (pricing.size < MIN_EXPECTED_ENTRIES) {
                throw new Error(
                    `only ${pricing.size} usable entries in response`
                )
            }

            console.log(`Loaded LiteLLM pricing for ${pricing.size} models`)
            return pricing
        } catch (error) {
            lastError = error
            console.error(
                `Failed to fetch LiteLLM pricing (attempt ${attempt}/${FETCH_ATTEMPTS}):`,
                error
            )
        }
    }

    throw new Error(
        `Could not load the LiteLLM pricing list from ${LITELLM_PRICES_URL}: ${
            lastError instanceof Error ? lastError.message : String(lastError)
        }`
    )
}

// Cached on globalThis so the instrumentation hook and route handlers share
// one copy even when Next.js bundles them as separate module graphs
const globalCache = globalThis as unknown as {
    litellmPricing?: Promise<Map<string, ModelPricing>>
}

export function loadModelPricing(): Promise<Map<string, ModelPricing>> {
    if (!globalCache.litellmPricing) {
        globalCache.litellmPricing = fetchPricingList().catch((error) => {
            globalCache.litellmPricing = undefined
            throw error
        })
    }
    return globalCache.litellmPricing
}

export async function resolveModelPrice(
    modelId: string,
    baseModelId?: string | null
): Promise<ModelPricing> {
    const pricing = await loadModelPricing()

    const candidates: string[] = []
    for (const id of [modelId, baseModelId]) {
        if (!id) {
            continue
        }
        candidates.push(id)
        const afterSlash = id.split('/').pop()
        if (afterSlash && afterSlash !== id) {
            candidates.push(afterSlash)
        }
        const dotParts = id.split('.')
        if (dotParts.length > 1) {
            candidates.push(dotParts[dotParts.length - 1])
        }
    }

    for (const candidate of candidates) {
        const match =
            pricing.get(candidate) ?? pricing.get(candidate.toLowerCase())
        if (match) {
            return match
        }
    }

    throw new Error(`Model "${modelId}" not found in the LiteLLM pricing list`)
}
