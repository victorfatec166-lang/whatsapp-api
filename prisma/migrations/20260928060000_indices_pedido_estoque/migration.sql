-- Indices medidos, nao adicionados por costume.
--
-- O EXPLAIN QUERY PLAN, medido antes desta migracao, mostrou SCAN completo em
-- todas as consultas de pedido, e "USE TEMP B-TREE FOR ORDER BY" nas que
-- ordenavam por data: o SQLite varria a tabela e depois ordenava tudo em
-- memoria. Com a base de 10 pedidos isso custava 0,25 ms e nao aparecia. O
-- problema e' o que vem com o historico -- um ano de pedidos passa a arrastar o
-- arquivo inteiro no Kanban do meio-dia.
--
-- [status] e [createdAt] resolvem o Kanban e o Relatorio. O indice composto
-- [status, createdAt] existe porque o Kanban e' a consulta mais repetida do
-- sistema e faz as duas coisas ao mesmo tempo: filtra por status e ordena por
-- data. Com dois indices separados o SQLite usaria um e ainda ordenaria em
-- memoria; com o composto, faz os dois de uma vez.
--
-- [trackStock] em Product serve a lista de reposicao, que roda a cada abertura
-- do painel e a cada venda, porque o alerta de estoque vem dela. A maioria do
-- catalogo nao tem controle, entao o indice ja corta quase tudo.
--
-- Criar indice no SQLite e uma operacao de leitura e escrita no arquivo. Com
-- a base grande, faca em horario de movimento calmo.

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Product_trackStock_idx" ON "Product"("trackStock");
