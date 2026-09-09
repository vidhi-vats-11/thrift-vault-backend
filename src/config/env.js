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
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
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
}
