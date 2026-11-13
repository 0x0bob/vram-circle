import { uploadHandler } from './_lib/handlers'
import { getDeps } from './_lib/deps'

// Vercel function: /api/upload. All logic lives in _lib/handlers.ts (unit tested with injected dependencies).
export async function POST(request: Request): Promise<Response> {
  return uploadHandler(request, getDeps())
}
