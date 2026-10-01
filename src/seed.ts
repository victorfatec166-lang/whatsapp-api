import { PrismaClient } from '@prisma/client';
import { logDoModulo } from './services/logger';
import { exigeLoja } from './services/loja';
const log = logDoModulo('seed');

const prisma = new PrismaClient();

async function main() {
    log.info('A inserir dados de teste...');

    /*
     * A linha de Config vem do servidor: getConfig() cria a "default" no
     * primeiro boot. Nao recrie aqui -- e nem reintroduza os campos que foram
     * removidos do schema (ver o model Config).
     */

    // Produtos de exemplo individuais
    const products = [
        { name: 'Marmita Executiva de Frango', description: 'Arroz, feijão, frango grelhado e salada', price: 20.00 },
        { name: 'Marmita Executiva de Carne', description: 'Arroz, feijão, carne de panela e batata frita', price: 24.00 },
        { name: 'Refrigerante Lata 350ml', description: 'Coca-Cola ou Guaraná', price: 6.00 }
    ];

    for (const p of products) {
        // Verifica se já existe para não duplicar
        const exists = await prisma.product.findFirst({ where: { name: p.name } });
        if (!exists) {
            await prisma.product.create({ data: { tenantId: exigeLoja(), ...p } });
        }
    }

    log.info('✅ Dados de teste inseridos com sucesso!');
}

main()
    .catch((e) => {
        log.error('Erro ao inserir dados:', e);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
