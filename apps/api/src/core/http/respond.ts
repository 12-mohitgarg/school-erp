/** Response envelope helpers — every controller returns through these. */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PaginationMeta } from '@erp/shared';
import { PAGINATION } from '@erp/shared';

/**
 * Wrap an async handler so a rejected promise reaches Express's error
 * middleware instead of crashing the process as an unhandled rejection.
 */
export function asyncHandler<
  T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
>(fn: T): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T): Response {
  return res.status(201).json({ success: true, data });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function accepted<T>(res: Response, data: T): Response {
  return res.status(202).json({ success: true, data });
}

/** Paginated list response, with the meta block clients use to drive pagers. */
export function paginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  limit: number,
  extra?: Record<string, unknown>,
): Response {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  const meta: PaginationMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
  return res.status(200).json({ success: true, data: items, meta: { ...meta, ...extra } });
}

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * Normalise `?page=&limit=` into Prisma-ready skip/take. Clamped so a client
 * cannot request an unbounded page and exhaust memory.
 */
export function pageParams(query: Record<string, unknown>): PageParams {
  const rawPage = Number(query['page']);
  const rawLimit = Number(query['limit']);

  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : PAGINATION.DEFAULT_PAGE;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/**
 * Build a Prisma `orderBy` from `?sortBy=&sortOrder=`, restricted to an
 * allow-list so a client cannot sort by an unindexed or private column.
 */
export function sortParams<T extends string>(
  query: Record<string, unknown>,
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const sortBy = String(query['sortBy'] ?? '');
  const order = String(query['sortOrder'] ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const field = (allowed as readonly string[]).includes(sortBy) ? sortBy : fallback;
  return { [field]: order };
}
