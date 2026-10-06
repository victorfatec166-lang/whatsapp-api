-- CreateTable
CREATE TABLE "CredencialProvisional" (
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredencialProvisional_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "CredencialProvisional" ADD CONSTRAINT "CredencialProvisional_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;