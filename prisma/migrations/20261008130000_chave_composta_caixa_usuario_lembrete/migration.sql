-- Indice unico de (tenantId, id) em Usuario, Turno de caixa, Lembrete e Item de marketplace.
--
-- A extensao do Prisma recusa `findUnique`/`update`/`delete` por `id` sozinho: sem a
-- loja na chave, um id da loja vizinha entraria na consulta. Sem estes indices nao
-- existe `where: { tenantId_id: ... }` e a operacao estoura -- foi assim que "fechar
-- turno de caixa", "promover usuario" e "apagar produto" passaram a responder erro.
--
-- Indice puro: nao reescreve dado, nao trava tabela. O par (loja, id) ja e' unico
-- porque `id` e' a chave primaria em todos os quatro.

CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");
CREATE UNIQUE INDEX "CashShift_tenantId_id_key" ON "CashShift"("tenantId", "id");
CREATE UNIQUE INDEX "Reminder_tenantId_id_key" ON "Reminder"("tenantId", "id");

-- O item do marketplace era unico por (conta, externalId). A conta ja pertence a uma
-- loja, mas a extensao nao consegue deduzir isso de uma chave que nao tem a loja --
-- entao a loja entra na chave e o indice antigo sai.
DROP INDEX "MarketplaceItem_accountId_externalId_key";
CREATE UNIQUE INDEX "MarketplaceItem_tenantId_accountId_externalId_key" ON "MarketplaceItem"("tenantId", "accountId", "externalId");