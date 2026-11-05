-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "brain_areas" DROP COLUMN "owner_user_id",
DROP COLUMN "reader_groups",
ADD COLUMN     "lead_user_ids" TEXT[];

-- AlterTable
ALTER TABLE "brain_members" DROP COLUMN "groups",
ADD COLUMN     "grants" TEXT[];

-- CreateTable
CREATE TABLE "promotion_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "note_title" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotion_requests_organization_id_dept_status_idx" ON "promotion_requests"("organization_id", "dept", "status");

-- CreateIndex
CREATE INDEX "promotion_requests_organization_id_requester_id_idx" ON "promotion_requests"("organization_id", "requester_id");

-- AddForeignKey
ALTER TABLE "promotion_requests" ADD CONSTRAINT "promotion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

