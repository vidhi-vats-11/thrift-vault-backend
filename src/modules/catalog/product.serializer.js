export const productInclude = {
  category: true,
  images: { orderBy: { sortOrder: "asc" } },
  sizes: { orderBy: { size: "asc" } },
}

// Each listing is one physical garment, so the images are angles on that one item.
// The storefront gallery labels them in this order.
const IMAGE_LABELS = ["Front", "Back", "Detail", "On model"]

// Mirrors the shape src/data/products.js already feeds the storefront components,
// so the React side can swap the static array for this payload without refactoring.
export const serializeProduct = (product, stats) => ({
  id: product.id,
  name: product.name,
  brand: product.brand,
  category: product.category?.name ?? null,
  categoryId: product.categoryId,
  price: product.priceCents / 100,
  originalPrice: product.originalPriceCents ? product.originalPriceCents / 100 : null,
  priceCents: product.priceCents,
  originalPriceCents: product.originalPriceCents,
  sizes: product.sizes?.map((s) => s.size) ?? [],
  condition: product.condition,
  era: product.era,
  gender: product.gender,
  tag: product.tag,
  description: product.description,
  highlights: product.highlights ?? [],
  // Ordered [{ label, value }] rows for the spec table
  details: product.details ?? [],
  flaws: product.flaws ?? null,
  stockQuantity: product.stockQuantity,
  status: product.status,
  image: product.images?.[0]?.url ?? null,
  images: product.images?.map((i) => i.url) ?? [],
  gallery:
    product.images?.map((img, i) => ({
      src: img.url,
      label: IMAGE_LABELS[i] ?? `View ${i + 1}`,
    })) ?? [],
  rating: stats?.rating ?? 0,
  reviews: stats?.count ?? 0,
  createdAt: product.createdAt,
})
