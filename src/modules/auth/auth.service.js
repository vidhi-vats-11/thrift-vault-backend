import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { createHash, randomBytes } from "node:crypto"
import { prisma } from "../../config/prisma.js"
import { env } from "../../config/env.js"
import { ApiError } from "../../lib/errors.js"

const BCRYPT_COST = 12

const hashToken = (token) => createHash("sha256").update(token).digest("hex")

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  phone: user.phone,
  gender: user.gender,
  createdAt: user.createdAt,
})

const issueTokens = async (user) => {
  const accessToken = jwt.sign({ sub: user.id, role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  })

  const refreshToken = randomBytes(48).toString("hex")
  const expiresAt = new Date(Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt },
  })

  return { accessToken, refreshToken, user: publicUser(user) }
}

export const signup = async ({ email, password, name }) => {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw ApiError.conflict("An account with that email already exists")

  const user = await prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
  })

  return issueTokens(user)
}

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } })
  // Same error for unknown email and wrong password so the endpoint can't enumerate accounts.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized("Invalid email or password")
  }
  return issueTokens(user)
}

export const refresh = async (refreshToken) => {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  })

  if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized("Refresh token is invalid or expired")
  }

  // Rotate: the presented token is burned as part of issuing the new pair.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  })

  return issueTokens(stored.user)
}

export const logout = async (refreshToken) => {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export const me = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw ApiError.notFound("User not found")
  return publicUser(user)
}

// Only the three profile fields are writable here. Email is deliberately excluded:
// it is the login identifier and changing it needs a verification flow, not a
// PATCH. Role is excluded so nobody can promote themselves to admin.
export const updateProfile = async (userId, patch) => {
  const data = {}
  if (patch.name !== undefined) data.name = patch.name
  // Empty string from a cleared form field means "unset", which is null in the DB.
  if (patch.phone !== undefined) data.phone = patch.phone === "" ? null : patch.phone
  if (patch.gender !== undefined) data.gender = patch.gender === "" ? null : patch.gender

  const user = await prisma.user.update({ where: { id: userId }, data })
  return publicUser(user)
}
