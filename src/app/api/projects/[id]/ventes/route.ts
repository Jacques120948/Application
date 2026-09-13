import { requireUser } from '@/server/auth/session'
import { listSales } from '@/server/runtime/payments'
import { fail, ok } from '@/server/http/respond'

/** Les ventes d'une application, vues par son créateur. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok(await listSales(user.id, id))
  } catch (error) {
    return fail(error)
  }
}
