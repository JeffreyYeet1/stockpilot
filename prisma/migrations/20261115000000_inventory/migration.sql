CREATE TABLE "InventorySnapshot" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "refreshedAt" DATETIME NOT NULL,
    "payload" TEXT NOT NULL
);

CREATE TABLE "StockRule" (
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL CHECK ("threshold" >= 1),
    "target" INTEGER NOT NULL CHECK ("target" >= "threshold"),
    PRIMARY KEY ("shop", "sku")
);
