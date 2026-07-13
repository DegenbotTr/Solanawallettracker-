-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "username" TEXT,
    "minTradeSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "WatchedWallet" (
    "userId" BIGINT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "WatchedWallet_pkey" PRIMARY KEY ("userId","walletAddress")
);

-- AddForeignKey
ALTER TABLE "WatchedWallet" ADD CONSTRAINT "WatchedWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedWallet" ADD CONSTRAINT "WatchedWallet_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
