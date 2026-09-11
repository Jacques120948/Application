import { requireUser } from '@/server/auth/session'
import { createProject, createProjectInput, listProjects } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function GET() {
  try {
    const user = await requireUser()
    return ok({ projects: await listProjects(user.id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = createProjectInput.parse(await readJson(request))
    return ok(await createProject(user.id, input), 201)
  } catch (error) {
    return fail(error)
  }
}
