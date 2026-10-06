-- CreateTable
CREATE TABLE "PedidoAberto" (
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'MENU',
    "productId" TEXT,
    "groupIndex" INTEGER NOT NULL DEFAULT 0,
    "picked" TEXT NOT NULL DEFAULT '{}',
    "offered" TEXT NOT NULL DEFAULT '[]',
    "carrinho" TEXT NOT NULL DEFAULT '[]',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoAberto_pkey" PRIMARY KEY ("tenantId","phone")
);

-- CreateIndex
CREATE INDEX "PedidoAberto_atualizadoEm_idx" ON "PedidoAberto"("atualizadoEm");

-- AddForeignKey
ALTER TABLE "PedidoAberto" ADD CONSTRAINT "PedidoAberto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;