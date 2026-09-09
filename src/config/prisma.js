import { PrismaClient } from "@prisma/client"

// Fluid Compute reuses a function instance across invocations, and `node --watch`
// re-imports this module on every save. Both would otherwise open a fresh pool
// each time and exhaust the database's connection limit, so the client is cached
// on globalThis and reused.
const globalForPrisma = globalThis

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

globalForPrisma.prisma = prisma
