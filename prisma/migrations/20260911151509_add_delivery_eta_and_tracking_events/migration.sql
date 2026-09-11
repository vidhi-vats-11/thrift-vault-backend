-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "expected_delivery_at" TIMESTAMP(3),
ADD COLUMN     "shipped_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_events_order_id_idx" ON "order_events"("order_id");

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
