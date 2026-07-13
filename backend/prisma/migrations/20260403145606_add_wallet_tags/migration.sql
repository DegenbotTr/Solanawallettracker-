-- AlterTable
ALTER TABLE "WatchedWallet" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
