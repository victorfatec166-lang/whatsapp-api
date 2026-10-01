/*
  Warnings:

  - The primary key for the `ProductModifierGroup` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `tenantId` to the `CashMovement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `CashShift` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ComboItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `DailyMenu` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `DailyMenuItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `MarketplaceAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `MarketplaceItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ModifierGroup` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ModifierOption` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ParkedSale` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `ProductModifierGroup` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Reminder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `StockMovement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);

-- RedefineTables
-- A loja que o sistema usa enquanto roda local. Toda linha que ja existia
-- pertence a ela: a migracao e' uma conversao, nao uma separacao.
INSERT INTO "Tenant" ("id", "name", "ativo", "criadoEm", "atualizadoEm") VALUES ('local', 'Minha loja', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BotMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "BotMessage_id_fkey" FOREIGN KEY ("id") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BotMessage" ("id", "key", "value") SELECT 'local', "key", "value" FROM "BotMessage";
DROP TABLE "BotMessage";
ALTER TABLE "new_BotMessage" RENAME TO "BotMessage";
CREATE UNIQUE INDEX "BotMessage_id_key_key" ON "BotMessage"("id", "key");
CREATE TABLE "new_CashMovement" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CashMovement" ("amount", "createdAt", "id", "note", "shiftId", "type", "tenantId") SELECT "amount", "createdAt", "id", "note", "shiftId", "type", 'local' FROM "CashMovement";
DROP TABLE "CashMovement";
ALTER TABLE "new_CashMovement" RENAME TO "CashMovement";
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");
CREATE INDEX "CashMovement_tenantId_createdAt_idx" ON "CashMovement"("tenantId", "createdAt");
CREATE TABLE "new_CashShift" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "openingFloat" REAL NOT NULL DEFAULT 0,
    "countedCash" REAL,
    "expectedCash" REAL,
    "difference" REAL,
    "note" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "CashShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CashShift" ("closedAt", "countedCash", "difference", "expectedCash", "id", "note", "openedAt", "openingFloat", "tenantId") SELECT "closedAt", "countedCash", "difference", "expectedCash", "id", "note", "openedAt", "openingFloat", 'local' FROM "CashShift";
DROP TABLE "CashShift";
ALTER TABLE "new_CashShift" RENAME TO "CashShift";
CREATE TABLE "new_Chat" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "telefone" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "avatarAt" DATETIME,
    "atendente" TEXT NOT NULL DEFAULT 'bot',
    "ultimaMensagem" TEXT NOT NULL DEFAULT '',
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assumidoAt" DATETIME,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Chat" ("assumidoAt", "atendente", "avatarAt", "avatarUrl", "createdAt", "id", "lastMessageAt", "name", "naoLidas", "orderId", "phone", "telefone", "ultimaMensagem", "updatedAt", "tenantId") SELECT "assumidoAt", "atendente", "avatarAt", "avatarUrl", "createdAt", "id", "lastMessageAt", "name", "naoLidas", "orderId", "phone", "telefone", "ultimaMensagem", "updatedAt", 'local' FROM "Chat";
DROP TABLE "Chat";
ALTER TABLE "new_Chat" RENAME TO "Chat";
CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");
CREATE INDEX "Chat_tenantId_lastMessageAt_idx" ON "Chat"("tenantId", "lastMessageAt");
CREATE UNIQUE INDEX "Chat_tenantId_phone_key" ON "Chat"("tenantId", "phone");
CREATE TABLE "new_ComboItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "comboId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ComboItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComboItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ComboItem" ("comboId", "componentId", "id", "quantity", "sortOrder", "tenantId") SELECT "comboId", "componentId", "id", "quantity", "sortOrder", 'local' FROM "ComboItem";
DROP TABLE "ComboItem";
ALTER TABLE "new_ComboItem" RENAME TO "ComboItem";
CREATE INDEX "ComboItem_comboId_idx" ON "ComboItem"("comboId");
CREATE UNIQUE INDEX "ComboItem_tenantId_comboId_componentId_key" ON "ComboItem"("tenantId", "comboId", "componentId");
CREATE TABLE "new_Config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessName" TEXT NOT NULL DEFAULT 'DeliveryAdmin',
    "cashAutoOpen" TEXT NOT NULL DEFAULT '',
    "cashAutoClose" TEXT NOT NULL DEFAULT '',
    "cashDefaultFloat" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Config_id_fkey" FOREIGN KEY ("id") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Config" ("businessName", "cashAutoClose", "cashAutoOpen", "cashDefaultFloat", "createdAt", "id", "updatedAt") SELECT "businessName", "cashAutoClose", "cashAutoOpen", "cashDefaultFloat", "createdAt", 'local', "updatedAt" FROM "Config";
DROP TABLE "Config";
ALTER TABLE "new_Config" RENAME TO "Config";
CREATE TABLE "new_DailyMenu" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyMenu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DailyMenu" ("createdAt", "date", "id", "note", "updatedAt", "tenantId") SELECT "createdAt", "date", "id", "note", "updatedAt", 'local' FROM "DailyMenu";
DROP TABLE "DailyMenu";
ALTER TABLE "new_DailyMenu" RENAME TO "DailyMenu";
CREATE UNIQUE INDEX "DailyMenu_tenantId_date_key" ON "DailyMenu"("tenantId", "date");
CREATE TABLE "new_DailyMenuItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "menuId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DailyMenuItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyMenuItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "DailyMenu" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyMenuItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DailyMenuItem" ("id", "menuId", "productId", "sortOrder", "tenantId") SELECT "id", "menuId", "productId", "sortOrder", 'local' FROM "DailyMenuItem";
DROP TABLE "DailyMenuItem";
ALTER TABLE "new_DailyMenuItem" RENAME TO "DailyMenuItem";
CREATE INDEX "DailyMenuItem_menuId_idx" ON "DailyMenuItem"("menuId");
CREATE INDEX "DailyMenuItem_tenantId_menuId_idx" ON "DailyMenuItem"("tenantId", "menuId");
CREATE UNIQUE INDEX "DailyMenuItem_menuId_productId_key" ON "DailyMenuItem"("menuId", "productId");
CREATE TABLE "new_MarketplaceAccount" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sem-credencial',
    "secretsEnc" TEXT NOT NULL DEFAULT '',
    "webhookSecretEnc" TEXT NOT NULL DEFAULT '',
    "lastOrderAt" DATETIME,
    "lastCheckAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketplaceAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MarketplaceAccount" ("channel", "createdAt", "id", "lastCheckAt", "lastError", "lastOrderAt", "secretsEnc", "status", "updatedAt", "webhookSecretEnc", "tenantId") SELECT "channel", "createdAt", "id", "lastCheckAt", "lastError", "lastOrderAt", "secretsEnc", "status", "updatedAt", "webhookSecretEnc", 'local' FROM "MarketplaceAccount";
DROP TABLE "MarketplaceAccount";
ALTER TABLE "new_MarketplaceAccount" RENAME TO "MarketplaceAccount";
CREATE UNIQUE INDEX "MarketplaceAccount_tenantId_channel_key" ON "MarketplaceAccount"("tenantId", "channel");
CREATE TABLE "new_MarketplaceItem" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lastPrice" REAL,
    "lastSyncedAt" DATETIME,
    CONSTRAINT "MarketplaceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketplaceItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketplaceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketplaceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MarketplaceItem" ("accountId", "externalId", "id", "lastPrice", "lastSyncedAt", "productId", "tenantId") SELECT "accountId", "externalId", "id", "lastPrice", "lastSyncedAt", "productId", 'local' FROM "MarketplaceItem";
DROP TABLE "MarketplaceItem";
ALTER TABLE "new_MarketplaceItem" RENAME TO "MarketplaceItem";
CREATE INDEX "MarketplaceItem_productId_idx" ON "MarketplaceItem"("productId");
CREATE INDEX "MarketplaceItem_tenantId_productId_idx" ON "MarketplaceItem"("tenantId", "productId");
CREATE UNIQUE INDEX "MarketplaceItem_accountId_externalId_key" ON "MarketplaceItem"("accountId", "externalId");
CREATE TABLE "new_Message" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "falhou" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("chatId", "createdAt", "falhou", "from", "id", "sentAt", "text", "tenantId") SELECT "chatId", "createdAt", "falhou", "from", "id", "sentAt", "text", 'local' FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_chatId_sentAt_idx" ON "Message"("chatId", "sentAt");
CREATE INDEX "Message_tenantId_createdAt_idx" ON "Message"("tenantId", "createdAt");
CREATE TABLE "new_ModifierGroup" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModifierGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ModifierGroup" ("createdAt", "id", "maxSelect", "minSelect", "name", "required", "sortOrder", "tenantId") SELECT "createdAt", "id", "maxSelect", "minSelect", "name", "required", "sortOrder", 'local' FROM "ModifierGroup";
DROP TABLE "ModifierGroup";
ALTER TABLE "new_ModifierGroup" RENAME TO "ModifierGroup";
CREATE TABLE "new_ModifierOption" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ModifierOption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ModifierOption" ("groupId", "id", "name", "prefix", "price", "sortOrder", "tenantId") SELECT "groupId", "id", "name", "prefix", "price", "sortOrder", 'local' FROM "ModifierOption";
DROP TABLE "ModifierOption";
ALTER TABLE "new_ModifierOption" RENAME TO "ModifierOption";
CREATE INDEX "ModifierOption_groupId_idx" ON "ModifierOption"("groupId");
CREATE TABLE "new_Order" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientPhone" TEXT NOT NULL,
    "clientName" TEXT,
    "items" TEXT NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "tip" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "paymentMethod" TEXT,
    "externalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("channel", "clientName", "clientPhone", "createdAt", "discount", "externalId", "id", "items", "notes", "paymentMethod", "status", "subtotal", "tip", "total", "updatedAt", "tenantId") SELECT "channel", "clientName", "clientPhone", "createdAt", "discount", "externalId", "id", "items", "notes", "paymentMethod", "status", "subtotal", "tip", "total", "updatedAt", 'local' FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");
CREATE UNIQUE INDEX "Order_tenantId_channel_externalId_key" ON "Order"("tenantId", "channel", "externalId");
CREATE TABLE "new_ParkedSale" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "items" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParkedSale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ParkedSale" ("createdAt", "id", "items", "label", "tenantId") SELECT "createdAt", "id", "items", "label", 'local' FROM "ParkedSale";
DROP TABLE "ParkedSale";
ALTER TABLE "new_ParkedSale" RENAME TO "ParkedSale";
CREATE TABLE "new_Product" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "imageUrl" TEXT,
    "price" REAL NOT NULL,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Geral',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "trackStock" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "isCombo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("category", "costPrice", "createdAt", "description", "id", "imageUrl", "isAvailable", "isCombo", "minStock", "name", "price", "sku", "stock", "trackStock", "updatedAt", "tenantId") SELECT "category", "costPrice", "createdAt", "description", "id", "imageUrl", "isAvailable", "isCombo", "minStock", "name", "price", "sku", "stock", "trackStock", "updatedAt", 'local' FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_trackStock_idx" ON "Product"("trackStock");
CREATE INDEX "Product_tenantId_name_idx" ON "Product"("tenantId", "name");
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
CREATE TABLE "new_ProductModifierGroup" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("tenantId", "productId", "groupId"),
    CONSTRAINT "ProductModifierGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductModifierGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductModifierGroup" ("groupId", "productId", "sortOrder", "tenantId") SELECT "groupId", "productId", "sortOrder", 'local' FROM "ProductModifierGroup";
DROP TABLE "ProductModifierGroup";
ALTER TABLE "new_ProductModifierGroup" RENAME TO "ProductModifierGroup";
CREATE TABLE "new_Reminder" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Reminder" ("createdAt", "date", "done", "id", "text", "tenantId") SELECT "createdAt", "date", "done", "id", "text", 'local' FROM "Reminder";
DROP TABLE "Reminder";
ALTER TABLE "new_Reminder" RENAME TO "Reminder";
CREATE INDEX "Reminder_date_idx" ON "Reminder"("date");
CREATE INDEX "Reminder_date_done_idx" ON "Reminder"("date", "done");
CREATE INDEX "Reminder_tenantId_date_done_idx" ON "Reminder"("tenantId", "date", "done");
CREATE TABLE "new_StockMovement" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("createdAt", "delta", "id", "note", "productId", "quantity", "source", "type", "tenantId") SELECT "createdAt", "delta", "id", "note", "productId", "quantity", "source", "type", 'local' FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");
CREATE TABLE "new_User" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "senhaSalt" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'admin',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "precisaTrocarSenha" BOOLEAN NOT NULL DEFAULT false,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" DATETIME,
    "codigoRecuperacao" TEXT,
    "recuperacaoExpiraEm" DATETIME,
    "ultimoLogin" DATETIME,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_User" ("ativo", "atualizadoEm", "bloqueadoAte", "codigoRecuperacao", "criadoEm", "email", "id", "nome", "papel", "precisaTrocarSenha", "recuperacaoExpiraEm", "senhaHash", "senhaSalt", "tentativas", "ultimoLogin", "tenantId") SELECT "ativo", "atualizadoEm", "bloqueadoAte", "codigoRecuperacao", "criadoEm", "email", "id", "nome", "papel", "precisaTrocarSenha", "recuperacaoExpiraEm", "senhaHash", "senhaSalt", "tentativas", "ultimoLogin", 'local' FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Tenant_ativo_idx" ON "Tenant"("ativo");
