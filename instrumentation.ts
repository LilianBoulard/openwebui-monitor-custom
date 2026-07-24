export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { loadModelPricing } = await import('@/lib/utils/model-pricing')
        try {
            await loadModelPricing()
        } catch (error) {
            // Pricing is mandatory: crash on startup rather than bill wrong prices
            console.error(error)
            process.exit(1)
        }
    }
}
