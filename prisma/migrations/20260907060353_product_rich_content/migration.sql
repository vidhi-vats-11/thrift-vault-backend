-- AlterTable
ALTER TABLE "products" ADD COLUMN     "condition_notes" TEXT,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[];
