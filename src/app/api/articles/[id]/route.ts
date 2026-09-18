import { requireUser } from '@/server/auth/session'
import { readArticle, supprimerArticle } from '@/server/audit/articles'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/** Un article : le relire coûte zéro, le jeter est une décision de son propriétaire. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ article: await readArticle(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    await supprimerArticle(user.id, id)
    return ok({ supprime: true })
  } catch (error) {
    return fail(error)
  }
}
