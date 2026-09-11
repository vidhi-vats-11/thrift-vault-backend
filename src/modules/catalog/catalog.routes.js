import { Router } from "express"
import { z } from "zod"
import * as catalogService from "./catalog.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth, attachUser } from "../../middleware/auth.js"
import { prisma } from "../../config/prisma.js"
import { asyncHandler } from "../../lib/errors.js"
import { sweepIfDue } from "../../jobs/releaseExpiredOrders.js"

const router = Router()

// Stock held by an abandoned checkout is invisible until it is released, so the
// catalogue is the one place worth paying for a (throttled) sweep before reading.
router.use(
  asyncHandler(async (_req, _res, next) => {
    await sweepIfDue()
    next()
  })
)

const listQuery = z.object({
  category: z.string().optional(),
  q: z.string().optional(),
  tag: z.string().optional(),
  condition: z.string().optional(),
  era: z.string().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
})

const idParam = z.object({ id: z.string().uuid() })

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
})

router.get(
  "/products",
  // Optional auth: signed-in shoppers get their gender used as a ranking hint,
  // anonymous ones get the default order. Read from the database rather than the
  // token so that changing it in Account settings takes effect immediately instead
  // of after the 15-minute access token expires.
  attachUser,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    let viewerGender = null
    if (req.user?.id) {
      const viewer = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { gender: true },
      })
      viewerGender = viewer?.gender ?? null
    }
    res.json(await catalogService.listProducts({ ...req.validatedQuery, viewerGender }))
  })
)

router.get(
  "/products/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await catalogService.getProduct(req.params.id))
  })
)

router.post(
  "/products/:id/reviews",
  requireAuth,
  validate({ params: idParam, body: reviewSchema }),
  asyncHandler(async (req, res) => {
    const review = await catalogService.createReview({
      productId: req.params.id,
      userId: req.user.id,
      ...req.body,
    })
    res.status(201).json(review)
  })
)

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json({ data: await catalogService.listCategories() })
  })
)

export default router
