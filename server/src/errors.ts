export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}
export const bad = (m: string) => new AppError(400, m)
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`)
export const conflict = (m: string) => new AppError(409, m)
export const forbidden = (m = 'Forbidden') => new AppError(403, m)
