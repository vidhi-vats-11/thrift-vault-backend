import { Router } from "express"
import { z } from "zod"
import * as orderService from "./order.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { rateLimit } from "../../middleware/rateLimit.js"
import { asyncHandler } from "../../lib/errors.js"

const router = Router()
router.use(requireAuth)

const idParam = z.object({ id: z.string().uuid() })

router.post(
  "/",
  rateLimit({ windowMs: 60 * 1000, max: 10, prefix: "orders" }),
  validate({ body: z.object({ addressId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await orderService.createOrder({
      userId: req.user.id,
      addressId: req.body.addressId,
      idempotencyKey: req.get("idempotency-key") ?? null,
    })
    res.status(result.replayed ? 200 : 201).json(result)
  })
)

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await orderService.listOrders(req.user.id) })
  })
)

router.get(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await orderService.getOrder(req.user.id, req.params.id))
  })
)

router.post(
  "/:id/cancel",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(await orderService.cancelOrder(req.user.id, req.params.id))
  })
)

export default router
