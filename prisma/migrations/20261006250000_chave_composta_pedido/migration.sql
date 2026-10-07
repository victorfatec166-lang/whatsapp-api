-- Indice unico de (tenantId, id) no Pedido.
--
-- A comanda da cozinha abria o pedido com `findUnique({ where: { id } })`, e a
-- extensao recusa `id` sozinho: sem a loja na chave, um id de pedido da loja
-- vizinha entraria. O sintoma era "Nao foi possivel montar a comanda" na tela do
-- pedido -- a cozinha sem papel para imprimir.
--
-- Indice puro: nao reescreve dado. O par (loja, id) ja e' unico porque `id` e' a
-- chave primaria.

CREATE UNIQUE INDEX "Order_tenantId_id_key" ON "Order"("tenantId", "id");