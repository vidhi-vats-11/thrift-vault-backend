import { Router } from "express"
import { z } from "zod"
import * as authService from "./auth.service.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { rateLimit } from "../../middleware/rateLimit.js"
import { asyncHandler } from "../../lib/errors.js"

const router = Router()

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, prefix: "auth" })

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(80),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

// Every field optional so the form can send a partial update. Phone allows "" so a
// shopper can clear it; the service turns that back into NULL. Digits/spaces and the
// usual punctuation only — deliberately loose, because phone formats vary by country.
const profileSchema = z
  .object({
    name: z.string().min(1).max(80),
    phone: z.union([z.string().regex(/^[\d\s+()-]{6,20}$/, "Enter a valid phone number"), z.literal("")]),
    gender: z.enum(["women", "men", "other", "prefer_not_to_say", ""]),
  })
  .partial()

router.post(
  "/signup",
  authLimiter,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await authService.signup(req.body))
  })
)

router.post(
  "/login",
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    res.json(await authService.login(req.body))
  })
)

router.post(
  "/refresh",
  authLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken))
  })
)

router.post(
  "/logout",
  requireAuth,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    await authService.logout(req.body.refreshToken)
    res.status(204).end()
  })
)

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await authService.me(req.user.id))
  })
)

router.patch(
  "/me",
  requireAuth,
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    res.json(await authService.updateProfile(req.user.id, req.body))
  })
)

export default router
