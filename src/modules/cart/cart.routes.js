import { Router } from "express"
import { z } from "zod"
import * as cartService from "./cart.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { asyncHandler } from "../../lib/errors.js"

const router = Router()
router.use(requireAuth)

const lineSchema = z.object({
  productId: z.string().uuid(),
  size: z.string().min(1).max(20),
  qty: z.number().int().min(1).max(10).default(1),
})

const idParam = z.object({ id: z.string().uuid() })

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await cartService.getCart(req.user.id))
  })
)

router.post(
  "/items",
  validate({ body: lineSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await cartService.addItem(req.user.id, req.body))
  })
)

router.patch(
  "/items/:id",
  validate({ params: idParam, body: z.object({ qty: z.number().int().min(1).max(10) }) }),
  asyncHandler(async (req, res) => {
    res.json(await cartService.updateItem(req.user.id, req.params.id, req.body.qty))
  })
)

router.delete(
  "/items/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await cartService.removeItem(req.user.id, req.params.id))
  })
)

router.delete(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await cartService.clearCart(req.user.id))
  })
)

router.post(
  "/merge",
  validate({ body: z.object({ items: z.array(lineSchema).max(100) }) }),
  asyncHandler(async (req, res) => {
    res.json(await cartService.mergeCart(req.user.id, req.body.items))
  })
)

export default router
