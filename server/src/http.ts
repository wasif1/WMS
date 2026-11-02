import type { NextFunction, Request, RequestHandler, Response } from 'express'
export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next)
}
export const ip = (req: Request) => req.ip ?? ''
export const nowIso = () => new Date().toISOString()
export const page = (req: Request) => ({
  limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500),
  offset: Math.max(Number(req.query.offset) || 0, 0),
})
