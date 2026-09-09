import { Router } from "express"
import { z } from "zod"
import * as catalogService from "./catalog.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { asyncHandler } from "../../lib/errors.js"

const router = Router()

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
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    res.json(await catalogService.listProducts(req.validatedQuery))
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
