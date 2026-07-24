import { NextRequest, NextResponse } from 'next/server'

import { query } from '@/lib/db/client'
import { resolveModelPrice } from '@/lib/utils/model-pricing'
import { verifyApiToken } from '@/lib/auth'

export async function POST(request: NextRequest) {
    const authError = verifyApiToken(request)
    if (authError) {
        return authError
    }

    try {
        const modelsResult = await query(
            `SELECT id, name, base_model_id FROM model_prices`
        )

        const refreshResults = []

        for (const model of modelsResult.rows) {
            let litellmPrice
            try {
                litellmPrice = await resolveModelPrice(
                    model.id,
                    model.base_model_id
                )
            } catch (error) {
                refreshResults.push({
                    id: model.id,
                    name: model.name,
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                })
                continue
            }

            const updateResult = await query(
                `UPDATE model_prices
         SET
           input_price = $2,
           output_price = $3,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
                [model.id, litellmPrice.input_price, litellmPrice.output_price]
            )

            const updatedModel = updateResult.rows[0]

            refreshResults.push({
                id: updatedModel.id,
                name: updatedModel.name,
                success: true,
                input_price: Number(updatedModel.input_price),
                output_price: Number(updatedModel.output_price),
                per_msg_price: Number(updatedModel.per_msg_price),
            })
        }

        const successCount = refreshResults.filter((r) => r.success).length

        return NextResponse.json({
            success: true,
            message: `Refreshed ${successCount} of ${refreshResults.length} models from LiteLLM`,
            refreshedModels: refreshResults,
        })
    } catch (error) {
        console.error('Refresh prices failed:', error)
        return NextResponse.json(
            {
                error: 'Refresh prices failed',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        )
    }
}

export async function OPTIONS() {
    return NextResponse.json({}, { status: 200 })
}
