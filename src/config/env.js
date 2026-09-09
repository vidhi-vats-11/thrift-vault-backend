import dotenv from "dotenv"

dotenv.config()

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback
  if (value === undefined) throw new Error(`Missing required env var: ${key}`)
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "",
  // Vercel sets this on every deployment. It gates the behaviour that assumes a
  // long-lived process with a writable disk.
  isServerless: Boolean(process.env.VERCEL),
  // Trimmed because these are typed into a dashboard field, where a stray space
  // after a comma would silently break CORS for that origin.
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },
  payments: {
    gateway: process.env.PAYMENT_GATEWAY ?? "mock",
    webhookSecret: required("PAYMENT_WEBHOOK_SECRET", "dev_webhook_secret"),
  },
  orderHoldMinutes: Number(process.env.ORDER_HOLD_MINUTES ?? 15),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  // Set automatically by the Vercel Blob integration. Its presence is what
  // switches image storage from local disk to Blob — see lib/storage.js.
  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? "",
  // Shared secret Vercel Cron sends as a bearer token, so the sweep endpoint
  // cannot be triggered by anyone who guesses the URL.
  cronSecret: process.env.CRON_SECRET ?? "",
}
