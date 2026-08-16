/** Inventory & Assets (PRD gap: "Inventory & Asset Management detail"). */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, created, paginated, pageParams } from '../../core/http/respond.js';
import { validate, idParam, uuidSchema, dateOnly, money, listQuery, Validated } from '../../core/http/validate.js';
import { requireAuth, requirePermission } from '../../core/auth/middleware.js';
import { scopedRequest, resolveWriteBranch } from '../../core/tenancy/scope.js';
import { auditFromRequest } from '../../core/audit/audit.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/db/prisma.js';

const router = Router();

// --- Items -----------------------------------------------------------------

router.get('/items', requirePermission('inventory:view'),
  validate({ query: listQuery.extend({ category: z.string().optional(), lowStock: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);
    const q = req.query as { search?: string; category?: string; lowStock?: boolean };

    const where = {
      ...tenant, isActive: true,
      ...(q.category ? { category: q.category } : {}),
      ...(q.search ? { OR: [
        { name: { contains: q.search, mode: 'insensitive' as const } },
        { code: { contains: q.search, mode: 'insensitive' as const } },
      ] } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({ where, skip, take, orderBy: { name: 'asc' },
        include: { vendor: { select: { id: true, name: true } } } }),
      prisma.inventoryItem.count({ where }),
    ]);

    // Prisma cannot compare two columns in a filter, so the low-stock check
    // (currentStock <= reorderLevel) is applied after the query.
    const filtered = q.lowStock ? items.filter((i) => i.currentStock <= i.reorderLevel) : items;

    return paginated(res, filtered, q.lowStock ? filtered.length : total, page, limit);
  }));

router.post('/items', requirePermission('inventory:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(30),
    category: z.enum(['STATIONERY', 'UNIFORM', 'LAB', 'SPORTS', 'FURNITURE', 'ELECTRONICS', 'CONSUMABLE']),
    description: z.string().max(500).optional(),
    unit: z.string().max(20).default('PCS'),
    currentStock: z.coerce.number().int().min(0).default(0),
    reorderLevel: z.coerce.number().int().min(0).default(10),
    reorderQuantity: z.coerce.number().int().min(1).default(50),
    unitCost: money.optional(),
    sellingPrice: money.optional(),
    gstRate: z.coerce.number().min(0).max(28).default(0),
    vendorId: uuidSchema.optional(),
    storageLocation: z.string().max(120).optional(),
    branchId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, ...fields } = body;

    const item = await prisma.inventoryItem.create({
      data: { tenantId: auth.tenantId, branchId, ...(fields as Validated) },
    });

    await auditFromRequest(req, { action: 'CREATE', module: 'inventory', entityType: 'InventoryItem', entityId: item.id });
    return created(res, item);
  }));

/** Record a stock movement and keep the running balance consistent. */
router.post('/items/:id/movements', requirePermission('inventory:update'),
  validate({ params: idParam, body: z.object({
    type: z.enum(['PURCHASE', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER']),
    quantity: z.coerce.number().int().refine((n) => n !== 0, 'Quantity cannot be zero'),
    unitCost: money.optional(),
    issuedToUserId: uuidSchema.optional(),
    referenceType: z.string().max(40).optional(),
    referenceId: z.string().max(60).optional(),
    remarks: z.string().max(300).optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const itemId = req.params['id']!;

    const movement = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, tenantId: auth.tenantId },
        select: { id: true, currentStock: true, name: true },
      });
      if (!item) throw AppError.notFound('Inventory item');

      // Outward movements are stored as negative quantities.
      const signed = ['ISSUE', 'DAMAGE', 'TRANSFER'].includes(body['type'] as string)
        ? -Math.abs(body['quantity'] as number)
        : (body['quantity'] as number);

      const balanceAfter = item.currentStock + signed;
      if (balanceAfter < 0) {
        throw AppError.conflict(
          `Only ${item.currentStock} units of ${item.name} are in stock`,
        );
      }

      const created_ = await tx.stockMovement.create({
        data: {
          itemId, movedById: auth.userId, quantity: signed, balanceAfter,
          type: body['type'] as never,
          unitCost: (body['unitCost'] as number) ?? null,
          totalValue: body['unitCost'] ? Math.abs(signed) * (body['unitCost'] as number) : null,
          issuedToUserId: (body['issuedToUserId'] as string) ?? null,
          referenceType: (body['referenceType'] as string) ?? null,
          referenceId: (body['referenceId'] as string) ?? null,
          remarks: (body['remarks'] as string) ?? null,
        },
      });

      await tx.inventoryItem.update({ where: { id: itemId }, data: { currentStock: balanceAfter } });
      return created_;
    });

    return created(res, movement);
  }));

router.get('/items/:id/movements', requirePermission('inventory:view'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, take } = pageParams(req.query);
    const where = { itemId: req.params['id']! };

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, skip, take, orderBy: { movedAt: 'desc' } }),
      prisma.stockMovement.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

// --- Vendors ---------------------------------------------------------------

router.get('/vendors', requirePermission('inventory:view'), asyncHandler(async (req, res) => {
  const { auth } = scopedRequest(req);
  return ok(res, await prisma.vendor.findMany({
    where: { tenantId: auth.tenantId, isActive: true }, orderBy: { name: 'asc' },
  }));
}));

router.post('/vendors', requirePermission('inventory:create'),
  validate({ body: z.object({
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(1).max(30),
    contactPerson: z.string().max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(10).max(15),
    gstin: z.string().max(20).optional(),
    city: z.string().max(80).optional(),
    rating: z.coerce.number().int().min(1).max(5).default(3),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    return created(res, await prisma.vendor.create({
      data: { tenantId: auth.tenantId, ...(req.body as Validated) },
    }));
  }));

// --- Assets ----------------------------------------------------------------

router.get('/assets', requirePermission('inventory:view'),
  validate({ query: listQuery.extend({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { tenant } = scopedRequest(req);
    const { page, limit, skip, take } = pageParams(req.query);

    const where = { ...tenant, ...(req.query['status'] ? { status: req.query['status'] as never } : {}) };
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.asset.count({ where }),
    ]);

    return paginated(res, items, total, page, limit);
  }));

router.post('/assets', requirePermission('inventory:create'),
  validate({ body: z.object({
    assetTag: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(160),
    category: z.string().min(1).max(60),
    serialNumber: z.string().max(80).optional(),
    make: z.string().max(60).optional(),
    model: z.string().max(60).optional(),
    purchaseDate: dateOnly.optional(),
    purchaseCost: money.optional(),
    warrantyUntil: dateOnly.optional(),
    usefulLifeYears: z.coerce.number().int().min(1).max(50).optional(),
    salvageValue: money.optional(),
    status: z.enum(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED']).default('IN_STORE'),
    location: z.string().max(160).optional(),
    assignedToId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
  }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = req.body as Record<string, unknown>;
    const branchId = resolveWriteBranch(auth, body['branchId'] as string | undefined);
    const { branchId: _b, ...fields } = body;

    // Straight-line depreciation: book value starts at cost and declines to
    // salvage over the useful life.
    const cost = (fields['purchaseCost'] as number) ?? 0;

    const asset = await prisma.asset.create({
      data: {
        tenantId: auth.tenantId, branchId,
        ...(fields as Validated),
        currentBookValue: cost || null,
        assignedAt: fields['assignedToId'] ? new Date() : null,
      },
    });

    return created(res, asset);
  }));

export default router;
