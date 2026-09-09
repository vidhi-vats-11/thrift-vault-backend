import { Router } from "express"
import { z } from "zod"
import multer from "multer"
import { prisma } from "../../config/prisma.js"
import { validate } from "../../middleware/validate.js"
import { requireAuth, requireAdmin } from "../../middleware/auth.js"
import { ApiError, asyncHandler } from "../../lib/errors.js"
import { storeImage } from "../../lib/storage.js"
import { productInclude, serializeProduct } from "../catalog/product.serializer.js"
import { serializeOrder } from "../order/order.service.js"

const router = Router()
router.use(requireAuth, requireAdmin)

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"])

const upload = multer({
  // Buffered rather than written straight to disk, so lib/storage.js can send the
  // bytes to whichever backend this environment uses. The 5 MB cap below keeps
  // the buffers small enough to hold in memory.
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(ApiError.badRequest("Only JPEG, PNG, WebP or AVIF images are allowed"))
    }
    cb(null, true)
  },
})

const productSchema = z.object({
  name: z.string().min(1).max(160),
  brand: z.string().min(1).max(120),
  categoryId: z.string().uuid(),
  priceCents: z.number().int().min(1),
  originalPriceCents: z.number().int().min(1).optional(),
  condition: z.string().min(1).max(40),
  era: z.string().min(1).max(40),
  tag: z.string().max(40).nullable().optional(),
  stockQuantity: z.number().int().min(0).default(1),
  description: z.string().max(4000).optional(),
  sizes: z.array(z.string().min(1).max(20)).default([]),
  images: z.array(z.string().url()).default([]),
})

const idParam = z.object({ id: z.string().uuid() })

router.get(
  "/products",
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      include: productInclude,
      orderBy: { createdAt: "desc" },
    })
    res.json({ data: products.map((p) => serializeProduct(p)) })
  })
)

router.post(
  "/products",
  validate({ body: productSchema }),
  asyncHandler(async (req, res) => {
    const { sizes, images, ...data } = req.body
    const product = await prisma.product.create({
      data: {
        ...data,
        sizes: { create: sizes.map((size) => ({ size })) },
        images: { create: images.map((url, sortOrder) => ({ url, sortOrder })) },
      },
      include: productInclude,
    })
    res.status(201).json(serializeProduct(product))
  })
)

router.patch(
  "/products/:id",
  validate({
    params: idParam,
    body: productSchema.partial().extend({
      status: z.enum(["live", "sold", "archived"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { sizes, images, ...data } = req.body

    const existing = await prisma.product.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Product not found")

    const product = await prisma.$transaction(async (tx) => {
      if (sizes) {
        await tx.productSize.deleteMany({ where: { productId: req.params.id } })
        await tx.productSize.createMany({
          data: sizes.map((size) => ({ productId: req.params.id, size })),
        })
      }
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: req.params.id } })
        await tx.productImage.createMany({
          data: images.map((url, sortOrder) => ({ productId: req.params.id, url, sortOrder })),
        })
      }
      return tx.product.update({
        where: { id: req.params.id },
        data: { ...data, version: { increment: 1 } },
        include: productInclude,
      })
    })

    res.json(serializeProduct(product))
  })
)

router.post(
  "/products/:id/images",
  validate({ params: idParam }),
  upload.array("images", 8),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { images: true },
    })
    if (!product) throw ApiError.notFound("Product not found")
    if (!req.files?.length) throw ApiError.badRequest("No images uploaded")

    const startOrder = product.images.length
    const urls = await Promise.all(req.files.map((file) => storeImage(file)))
    await prisma.productImage.createMany({
      data: urls.map((url, index) => ({
        productId: product.id,
        url,
        sortOrder: startOrder + index,
      })),
    })

    const updated = await prisma.product.findUnique({
      where: { id: product.id },
      include: productInclude,
    })
    res.status(201).json(serializeProduct(updated))
  })
)

router.post(
  "/categories",
  validate({ body: z.object({ name: z.string().min(1).max(60) }) }),
  asyncHandler(async (req, res) => {
    const name = req.body.name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    res.status(201).json(await prisma.category.create({ data: { name, slug } }))
  })
)

router.get(
  "/orders",
  validate({
    query: z.object({
      status: z.enum(["pending_payment", "paid", "cancelled", "fulfilled"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: req.validatedQuery.status ? { status: req.validatedQuery.status } : {},
      include: {
        items: { include: { product: { include: { images: true } } } },
        payments: true,
        address: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({
      data: orders.map((o) => ({ ...serializeOrder(o), customer: o.user })),
    })
  })
)

router.patch(
  "/orders/:id",
  validate({
    params: idParam,
    body: z.object({ status: z.enum(["paid", "cancelled", "fulfilled"]) }),
  }),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } })
    if (!order) throw ApiError.notFound("Order not found")

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
      include: {
        items: { include: { product: { include: { images: true } } } },
        payments: true,
        address: true,
      },
    })
    res.json(serializeOrder(updated))
  })
)

export default router
