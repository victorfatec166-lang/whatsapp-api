-- Marketplace: contas de iFood e 99Food, e o casamento dos itens.
--
-- A migracao NAO conecta em nada. Ela cria a estrutura onde as credenciais
-- vao ficar e onde o pedido de fora vai entrar, e nada mais. Conectar depende
-- de credencial de parceiro, que e' o que impede a tela de prometer o que nao
-- pode cumprir.
--
-- externalId em Order, com indice unico junto do channel, resolve o problema
-- mais chato de webhook: plataforma reenvia pedido quando a resposta anterior
-- nao chegou, e sem isso o mesmo pedido entraria duas vezes no Kanban. O
-- indice tambem e' o que torna a checagem barata, porque webhook chega em
-- rajada e a busca nao pode varrer o historico.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "externalId" TEXT;

-- CreateTable
CREATE TABLE "MarketplaceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sem-credencial',
    "secretsEnc" TEXT NOT NULL DEFAULT '',
    "webhookSecretEnc" TEXT NOT NULL DEFAULT '',
    "lastOrderAt" DATETIME,
    "lastCheckAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketplaceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lastPrice" REAL,
    "lastSyncedAt" DATETIME,
    CONSTRAINT "MarketplaceItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketplaceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketplaceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceAccount_channel_key" ON "MarketplaceAccount"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceItem_accountId_externalId_key" ON "MarketplaceItem"("accountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channel_externalId_key" ON "Order"("channel", "externalId");

-- CreateIndex
CREATE INDEX "MarketplaceItem_productId_idx" ON "MarketplaceItem"("productId");
