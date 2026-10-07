-- Indice unico de (tenantId, id) no Produto.
--
-- A extensao do Prisma recusa `findUnique`/`update` por `id` sozinho: sem a loja na
-- chave, um id da loja vizinha entraria na consulta. Sem este indice nao existe
-- `where: { tenantId_id: ... }`, e o bot nao consegue nem ler o produto que o
-- cliente escolheu pelo numero.
--
-- Indice puro: nao reescreve dado, nao trava tabela. Se houvesse produto repetido
-- por loja, este CREATE falharia -- e a constraint `tenantId_sku` ja garante que o
-- par loja+id e' unico, porque `id` e' a chave primaria.

CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");