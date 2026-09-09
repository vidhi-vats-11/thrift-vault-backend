import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../config/prisma.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError, asyncHandler } from "../../lib/errors.js"
import { productInclude, serializeProduct } from "../catalog/product.serializer.js"

const router = Router()
router.use(requireAuth)

const productIdParam = z.object({ productId: z.string().uuid() })

const getWishlist = async (userId) => {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    include: { product: { include: productInclude } },
    orderBy: { addedAt: "desc" },
  })
  return {
    data: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      addedAt: row.addedAt,
      product: serializeProduct(row.product),
    })),
  }
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getWishlist(req.user.id))
  })
)

// Must be declared before POST /:productId, or "merge" is parsed as a product id
// and rejected by the uuid validator.
router.post(
  "/merge",
  validate({ body: z.object({ productIds: z.array(z.string().uuid()).max(200) }) }),
  asyncHandler(async (req, res) => {
    const userId = req.user.id
    const existing = await prisma.product.findMany({
      where: { id: { in: req.body.productIds } },
      select: { id: true },
    })

    await prisma.wishlistItem.createMany({
      data: existing.map((p) => ({ userId, productId: p.id })),
      skipDuplicates: true,
    })

    res.json(await getWishlist(userId))
  })
)

router.post(
  "/:productId",
  validate({ params: productIdParam }),
  asyncHandler(async (req, res) => {
    const { productId } = req.params
    const userId = req.user.id

    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) throw ApiError.notFound("Product not found")

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
    })

    if (existing) {
      await prisma.wishlistItem.delete({ where: { id: existing.id } })
      return res.json({ saved: false, ...(await getWishlist(userId)) })
    }

    await prisma.wishlistItem.create({ data: { userId, productId } })
    res.status(201).json({ saved: true, ...(await getWishlist(userId)) })
  })
)

router.delete(
  "/:productId",
  validate({ params: productIdParam }),
  asyncHandler(async (req, res) => {
    const { count } = await prisma.wishlistItem.deleteMany({
      where: { userId: req.user.id, productId: req.params.productId },
    })
    if (count === 0) throw ApiError.notFound("Item is not in your wishlist")
    res.json({ saved: false, ...(await getWishlist(req.user.id)) })
  })
)

export default router
