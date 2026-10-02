-- Foto de produto no banco.
--
-- A foto vivia em arquivo, no disco da maquina, e servia por `/uploads`. Na nuvem
-- esse disco some a cada deploy -- o Render nao monta disco no plano gratuito --
-- entao toda foto cadastrada era perdida no primeiro deploy seguinte. Guardando
-- os bytes junto do produto, ela passa a sobreviver a reinicio e a atualizacao.
ALTER TABLE "Product" ADD COLUMN "imageData" BYTEA;
ALTER TABLE "Product" ADD COLUMN "imageMime" TEXT;