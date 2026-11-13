import { adviceHandler } from './_lib/handlers'
import { getDeps } from './_lib/deps'

// Vercel function: /api/advice. All logic lives in _lib/handlers.ts (unit tested with injected dependencies).
export async function GET(request: Request): Promise<Response> {
  return adviceHandler(request, getDeps())
}
