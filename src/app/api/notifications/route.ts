import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { countUnread, listNotifications, markRead } from '@/server/notifications/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ ids: z.array(z.string().uuid()).max(100).optional() })

export async function GET() {
  try {
    const user = await requireUser()
    const [notifications, unread] = await Promise.all([listNotifications(user.id), countUnread(user.id)])
    return ok({ notifications, unread })
  } catch (error) {
    return fail(error)
  }
}

/** Marquer comme lu : tout, ou une liste. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    await markRead(user.id, body.ids)
    return ok({ unread: await countUnread(user.id) })
  } catch (error) {
    return fail(error)
  }
}
