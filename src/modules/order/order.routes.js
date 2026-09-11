import { Router } from "express"
import { z } from "zod"
import * as orderService from "./order.service.js"
import * as returnService from "./return.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { rateLimit } from "../../middleware/rateLimit.js"
import { asyncHandler } from "../../lib/errors.js"

const router = Router()
router.use(requireAuth)

const idParam = z.object({ id: z.string().uuid() })
const REASON_VALUES = returnService.REASONS.map((r) => r.value)

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

// ── returns & exchanges ───────────────────────────────────────────────────────
//
// These MUST be declared above "/:id". Express matches routes in definition order,
// so with "/:id" first a request for /orders/returns/mine would be read as an order
// whose id is the literal string "returns" and rejected by the uuid validator.

router.get(
  "/returns/reasons",
  asyncHandler(async (_req, res) => {
    res.json({ data: returnService.REASONS, windowDays: returnService.RETURN_WINDOW_DAYS })
  })
)

router.get(
  "/returns/mine",
  asyncHandler(async (req, res) => {
    res.json({ data: await returnService.listMyReturns(req.user.id) })
  })
)

router.post(
  "/returns",
  rateLimit({ windowMs: 60 * 1000, max: 10, prefix: "returns" }),
  validate({
    body: z.object({
      orderItemId: z.string().uuid(),
      type: z.enum(["refund", "exchange"]),
      reason: z.enum(REASON_VALUES),
      note: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await returnService.createReturn({ userId: req.user.id, ...req.body }))
  })
)

// ── single order ──────────────────────────────────────────────────────────────

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
