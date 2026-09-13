import { requireUser } from '@/server/auth/session'
import { buildMobileKit } from '@/server/export/mobile'
import { fail } from '@/server/http/respond'

export const maxDuration = 60

/** Télécharge le dossier de publication mobile. Lecture seule, comme l'export. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser()
    const { id } = await params
    const result = await buildMobileKit(user.id, id)

    return new Response(new Uint8Array(result.archive), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(result.bytes),
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    return fail(error)
  }
}
