-- AlterTable
ALTER TABLE "Config" ADD COLUMN     "botAtivo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botAvisoPausado" TEXT NOT NULL DEFAULT '';