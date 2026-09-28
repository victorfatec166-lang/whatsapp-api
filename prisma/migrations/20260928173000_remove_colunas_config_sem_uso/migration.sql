-- Remove colunas de Config que eram gravadas e nunca lidas.
--
-- Nenhuma delas tinha valor real: a tabela Config tem uma linha so (id fixo
-- "default"), com businessName preenchido e o resto no padrao de fabrica. O
-- aviso do Prisma ("1 non-null values" por coluna) confirma que existia valor,
-- mas era o padrao.
--
-- O SQLite nao tem DROP COLUMN em versoes antigas e o Prisma reconstroi a
-- tabela, entao o caminho e: cria a nova, copia o que fica, derruba a antiga,
-- renomeia.
--
-- businessName, cashAutoOpen, cashAutoClose, cashDefaultFloat, createdAt e
-- updatedAt sobrevivem. Nenhuma delas e' NOT NULL sem default, entao a copia
-- direta funciona.

-- Redefine a tabela "Config"
CREATE TABLE "new_Config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessName" TEXT NOT NULL DEFAULT 'DeliveryAdmin',
    "cashAutoOpen" TEXT NOT NULL DEFAULT '',
    "cashAutoClose" TEXT NOT NULL DEFAULT '',
    "cashDefaultFloat" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Copia os dados das colunas que sobram
INSERT INTO "new_Config" ("id", "businessName", "cashAutoOpen", "cashAutoClose", "cashDefaultFloat", "createdAt", "updatedAt")
SELECT "id", "businessName", "cashAutoOpen", "cashAutoClose", "cashDefaultFloat", "createdAt", "updatedAt"
FROM "Config";

-- Derruba a tabela antiga
DROP TABLE "Config";

-- Renomeia a nova para o nome definitivo
ALTER TABLE "new_Config" RENAME TO "Config";
