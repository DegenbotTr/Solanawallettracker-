-- CreateTable
CREATE TABLE "GroupTokenCall" (
    "id" TEXT NOT NULL,
    "groupId" BIGINT NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupTokenCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupTokenCall_groupId_calledAt_idx" ON "GroupTokenCall"("groupId", "calledAt");

-- CreateIndex
CREATE INDEX "GroupTokenCall_groupId_mint_idx" ON "GroupTokenCall"("groupId", "mint");
