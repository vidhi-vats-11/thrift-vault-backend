import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../config/prisma.js"
import { validate } from "../../middleware/validate.js"
import { rateLimit } from "../../middleware/rateLimit.js"
import { asyncHandler } from "../../lib/errors.js"
import { sendNewsletterWelcome } from "../../lib/email.js"

const router = Router()

router.post(
  "/subscribe",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, prefix: "newsletter" }),
  validate({ body: z.object({ email: z.string().email() }) }),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase()
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })

    if (!existing) {
      await prisma.newsletterSubscriber.create({ data: { email } })
      await sendNewsletterWelcome(email)
    }

    // Always 200 with the same shape — re-subscribing is not an error for the UI,
    // and it avoids leaking whether an address is already on the list.
    res.json({ subscribed: true, email })
  })
)

export default router
