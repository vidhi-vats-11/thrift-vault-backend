import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../config/prisma.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError, asyncHandler } from "../../lib/errors.js"

const router = Router()
router.use(requireAuth)

const addressSchema = z.object({
  recipientName: z.string().min(1).max(120).optional(),
  phone: z.string().min(5).max(30).optional(),
  line1: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().min(3).max(20),
  country: z.string().min(2).max(60),
  isDefault: z.boolean().default(false),
})

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({
      data: await prisma.address.findMany({
        where: { userId: req.user.id },
        orderBy: [{ isDefault: "desc" }],
      }),
    })
  })
)

router.post(
  "/",
  validate({ body: addressSchema }),
  asyncHandler(async (req, res) => {
    const userId = req.user.id
    if (req.body.isDefault) {
      await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } })
    }
    res.status(201).json(await prisma.address.create({ data: { ...req.body, userId } }))
  })
)

router.delete(
  "/:id",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const { count } = await prisma.address.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    })
    if (count === 0) throw ApiError.notFound("Address not found")
    res.status(204).end()
  })
)

export default router
