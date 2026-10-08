-- Fila de pedidos do marketplace para a loja que roda o sistema na propria maquina.
--
-- A loja local nao tem URL publica, entao o iFood e o 99Food nao alcancam o PC dela.
-- O webhook continua chegando aqui, que tem endereco publico e o segredo HMAC: ele
-- confere a assinatura, guarda o corpo CRU em `PedidoEntrante` e responde 200 na hora
-- -- a plataforma nao espera o PC da loja responder. O PC da loja puxa a fila e grava
-- o pedido no banco dele.
--
-- `Tenant.local` diz quem esta no modo local: enquanto for falso, o webhook grava o
-- pedido direto como sempre. E' o que permite migrar uma loja por vez.
--
-- O corpo vai cru porque a assinatura ja foi conferida no caminho, e porque
-- normalizar depende do mapa de itens, que e' da loja. `ChaveDeLoja` guarda o HASH do
-- segredo de acesso do PC -- o segredo em si so existe na loja.

ALTER TABLE "Config" ADD COLUMN     "relayChaveEnc" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "local" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PedidoEntrante" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "entregueEm" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,

    CONSTRAINT "PedidoEntrante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChaveDeLoja" (
    "tenantId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "ChaveDeLoja_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "PedidoEntrante_tenantId_entregueEm_expiraEm_idx" ON "PedidoEntrante"("tenantId", "entregueEm", "expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoEntrante_tenantId_channel_externalId_key" ON "PedidoEntrante"("tenantId", "channel", "externalId");

-- AddForeignKey
ALTER TABLE "PedidoEntrante" ADD CONSTRAINT "PedidoEntrante_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveDeLoja" ADD CONSTRAINT "ChaveDeLoja_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

