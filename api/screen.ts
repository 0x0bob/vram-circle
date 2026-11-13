import { screenHandler } from './_lib/handlers'
import { getDeps } from './_lib/deps'

// Vercel function: /api/screen. All logic lives in _lib/handlers.ts (unit tested with injected dependencies).
export async function POST(request: Request): Promise<Response> {
  return screenHandler(request, getDeps())
}
