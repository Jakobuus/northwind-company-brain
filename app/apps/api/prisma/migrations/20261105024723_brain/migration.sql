-- CreateTable
CREATE TABLE "brain_areas" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "reader_groups" TEXT[],
    "topics" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brain_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "groups" TEXT[],
    "home" TEXT,
    "rank_override" INTEGER,
    "title" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brain_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_areas_organization_id_idx" ON "brain_areas"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_areas_organization_id_slug_key" ON "brain_areas"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "brain_members_organization_id_idx" ON "brain_members"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_members_organization_id_user_id_key" ON "brain_members"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "brain_areas" ADD CONSTRAINT "brain_areas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_members" ADD CONSTRAINT "brain_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
