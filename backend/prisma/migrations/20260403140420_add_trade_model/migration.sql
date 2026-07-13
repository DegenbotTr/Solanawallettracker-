-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL DEFAULT '',
    "tokenAmount" DOUBLE PRECISION NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "solAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signature" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trade_signature_key" ON "Trade"("signature");

-- CreateIndex
CREATE INDEX "Trade_walletAddress_tokenMint_idx" ON "Trade"("walletAddress", "tokenMint");

-- CreateIndex
CREATE INDEX "Trade_walletAddress_timestamp_idx" ON "Trade"("walletAddress", "timestamp");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "Wallet"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
