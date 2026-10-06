-- CreateTable
CREATE TABLE "SessaoWhatsApp" (
    "tenantId" TEXT NOT NULL,
    "maquinaId" TEXT NOT NULL,
    "creds" TEXT NOT NULL,
    "telefone" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessaoWhatsApp_pkey" PRIMARY KEY ("tenantId","maquinaId")
);

-- CreateTable
CREATE TABLE "ChaveWhatsApp" (
    "tenantId" TEXT NOT NULL,
    "maquinaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChaveWhatsApp_pkey" PRIMARY KEY ("tenantId","maquinaId","tipo","chave")
);

-- CreateIndex
CREATE INDEX "SessaoWhatsApp_atualizadoEm_idx" ON "SessaoWhatsApp"("atualizadoEm");

-- CreateIndex
CREATE INDEX "ChaveWhatsApp_atualizadoEm_idx" ON "ChaveWhatsApp"("atualizadoEm");

-- AddForeignKey
ALTER TABLE "SessaoWhatsApp" ADD CONSTRAINT "SessaoWhatsApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveWhatsApp" ADD CONSTRAINT "ChaveWhatsApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;