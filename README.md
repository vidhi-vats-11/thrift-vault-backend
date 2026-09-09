# Thrift Vault — Backend API

Implementation of `TECHDOC.pdf`: Node.js + Express + PostgreSQL + Prisma, serving the
React/Vite storefront in `../Frontend`.

## Quick start (Docker — recommended)

```bash
cd Backend
docker compose up -d
```

That brings up Postgres, Redis and the API, runs migrations, and seeds the catalog.
API is at **http://localhost:4000**, health check at `/health`.

Host ports are shifted (Postgres `5433`, Redis `6380`) so the stack does not collide
with a Postgres or Redis you already run locally.

## Quick start (host Node, containers for data stores)

```bash
cd Backend
cp .env.example .env
npm install
docker compose up -d postgres redis
npx prisma migrate deploy && npm run seed
npm run dev
```

## Seeded logins

| Role    | Email                       | Password       |
| ------- | --------------------------- | -------------- |
| Admin   | `admin@thriftvault.test`    | `Password123!` |
| Shopper | `shopper@thriftvault.test`  | `Password123!` |

The 12 seeded products are ported from the frontend's `src/data/products.js`, each at
`stock_quantity = 1` to match the one-of-one secondhand model.

## Postman

Import both files from `postman/`:

- `ThriftVault.postman_collection.json`
- `ThriftVault.postman_environment.json`

Select the **Thrift Vault — Local** environment and run the folders top to bottom
(or use the Collection Runner). Test scripts capture tokens, product ids, order ids
and the webhook signature into environment variables automatically — nothing needs to
be pasted by hand.

Folder `06 — Checkout & Payment` walks the full purchase: add to cart → create order
(stock is held) → sign the webhook → post it → order becomes `paid`.

To run it headlessly:

```bash
npx newman run postman/ThriftVault.postman_collection.json \
  -e postman/ThriftVault.postman_environment.json
```

## API surface

Base path `/api/v1`. Auth is `Authorization: Bearer <accessToken>`.

| Module     | Endpoint                             | Auth   |
| ---------- | ------------------------------------ | ------ |
| Auth       | `POST /auth/signup`                  | public |
| Auth       | `POST /auth/login`                   | public |
| Auth       | `POST /auth/refresh`                 | public |
| Auth       | `POST /auth/logout`                  | user   |
| Auth       | `GET /auth/me`                       | user   |
| Catalog    | `GET /products` (`?category ?q ?tag ?condition ?era ?sort ?page ?limit`) | public |
| Catalog    | `GET /products/:id`                  | public |
| Catalog    | `GET /categories`                    | public |
| Cart       | `GET /cart`                          | user   |
| Cart       | `POST /cart/items`                   | user   |
| Cart       | `PATCH /cart/items/:id`              | user   |
| Cart       | `DELETE /cart/items/:id`             | user   |
| Cart       | `DELETE /cart`                       | user   |
| Cart       | `POST /cart/merge`                   | user   |
| Wishlist   | `GET /wishlist`                      | user   |
| Wishlist   | `POST /wishlist/:productId` (toggle) | user   |
| Wishlist   | `DELETE /wishlist/:productId`        | user   |
| Wishlist   | `POST /wishlist/merge`               | user   |
| Addresses  | `GET POST /addresses`, `DELETE /addresses/:id` | user |
| Checkout   | `POST /orders`                       | user   |
| Checkout   | `GET /orders`, `GET /orders/:id`     | user   |
| Checkout   | `POST /orders/:id/cancel`            | user   |
| Payment    | `POST /payments/webhook`             | signature |
| Payment    | `POST /payments/:id/refund`          | admin  |
| Reviews    | `POST /products/:id/reviews`         | user   |
| Newsletter | `POST /newsletter/subscribe`         | public |
| Admin      | `GET POST /admin/products`, `PATCH /admin/products/:id` | admin |
| Admin      | `POST /admin/products/:id/images`    | admin  |
| Admin      | `POST /admin/categories`             | admin  |
| Admin      | `GET /admin/orders`, `PATCH /admin/orders/:id` | admin |

## How the inventory guarantee works

The tech doc's central constraint is that two customers must never both win the same
one-of-one item. Implemented in `src/modules/order/order.service.js`:

- Adding to cart **does not** reserve stock — carts can sit idle for days.
- `POST /orders` opens a transaction and takes `SELECT … FOR UPDATE` on every product
  row in the cart, **ordered by id** so two concurrent checkouts sharing items cannot
  deadlock by locking in opposite orders.
- Inside the lock: re-check stock, decrement, flip `status` to `sold` at zero, insert the
  order as `pending_payment`, clear the cart, commit. A loser gets `409` naming the items.
- The order carries `expiresAt` (`ORDER_HOLD_MINUTES`, default 15). A sweeper
  (`src/jobs/releaseExpiredOrders.js`, every 60s) returns stock for abandoned checkouts
  and cancels the order, so an item is never stuck reserved forever.
- `POST /orders` honours an `Idempotency-Key` header — a retried request returns the
  original order rather than holding stock twice.

Verified behaviours: two simultaneous checkouts on a `stock=1` item yield exactly one
`201` and one `409`, stock never goes negative, cancel restores stock, and a second
cancel/sweep does not inflate it.

## Payments

`PAYMENT_GATEWAY=mock` (default) uses `src/modules/payment/gateways/mock.gateway.js`.
It mirrors Razorpay's shape — HMAC-SHA256 over the raw request body in an
`x-webhook-signature` header — so swapping in a real Razorpay/Stripe adapter is a
config change behind the same interface, not an API change.

Webhooks are idempotent (a replay returns `duplicate: true` and leaves the order
`paid`) and a forged signature is rejected with `401`.

For local testing, `POST /payments/mock/sign` returns the signature for a payload.
It is disabled when `NODE_ENV=production`.

Simulate a failed payment by posting the same webhook shape with
`"event": "payment.failed"` — the order is cancelled and stock is released.

## Environment

See `.env.example`. `REDIS_URL` is optional: without it the rate limiter falls back to
an in-process counter, which is correct for a single instance but not across replicas.

Product images upload to a local `uploads/` volume served at `/uploads`; order and
newsletter emails are logged as structured JSON rather than sent. Both are swappable
for S3/Cloudinary and a real SMTP provider without touching callers.

## Not implemented (open questions from the tech doc §5)

Guest checkout is **not** supported — checkout requires an account, so cart, wishlist
and orders all hang off a user. Returns/exchanges, shipping charges, and multi-currency
are out of scope for v1; `total_cents` currently equals `subtotal_cents`.
