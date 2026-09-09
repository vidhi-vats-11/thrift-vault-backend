import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { put } from "@vercel/blob"
import { env } from "../config/env.js"

// Product images need somewhere durable to live. On a normal server that is the
// local disk, but Vercel's filesystem is read-only apart from /tmp and is thrown
// away between invocations, so anything written there would vanish. Both backends
// return the URL to persist on ProductImage.url.

// Never derive the stored name from the client-supplied filename — that is a
// path-traversal vector. Only the extension is carried over, and only if it is safe.
const storedName = (originalname) => {
  const ext = path.extname(originalname).toLowerCase()
  const safeExt = /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : ".jpg"
  return `${randomUUID()}${safeExt}`
}

const toDisk = async (file) => {
  const name = storedName(file.originalname)
  // Created lazily rather than at import time: on a read-only filesystem an
  // import-time mkdir would crash the whole app, not just uploads.
  await fs.mkdir(env.uploadDir, { recursive: true })
  await fs.writeFile(path.join(env.uploadDir, name), file.buffer)
  return `/uploads/${name}`
}

const toBlob = async (file) => {
  const blob = await put(`products/${storedName(file.originalname)}`, file.buffer, {
    access: "public",
    contentType: file.mimetype,
    // The name is already a UUID, so Blob's own suffix would only make the URL
    // harder to read.
    addRandomSuffix: false,
  })
  return blob.url
}

/** Persists one uploaded file and returns the URL to serve it from. */
export const storeImage = env.blobToken ? toBlob : toDisk

export const storageBackend = env.blobToken ? "blob" : "disk"
