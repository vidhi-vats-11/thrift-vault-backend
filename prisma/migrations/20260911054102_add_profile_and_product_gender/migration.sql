-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('women', 'men', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "ProductGender" AS ENUM ('women', 'men', 'unisex');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gender" "ProductGender" NOT NULL DEFAULT 'unisex';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gender" "Gender",
ADD COLUMN     "phone" TEXT;
