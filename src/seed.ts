import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('A inserir dados de teste...');

  // Configuração padrão da morada de origem e taxas
  await prisma.config.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      originAddress: 'Rua Principal, 100 - Mogi Mirim, SP',
      feePerKm: 2.50,
      baseFee: 3.00,
      googleApiKey: ''
    }
  });

  // Produtos de exemplo individuais
  const products = [
    { name: 'Marmita Executiva de Frango', description: 'Arroz, feijão, frango grelhado e salada', price: 20.00, isAvailable: true },
    { name: 'Marmita Executiva de Carne', description: 'Arroz, feijão, carne de panela e batata frita', price: 24.00, isAvailable: true },
    { name: 'Refrigerante Lata 350ml', description: 'Coca-Cola ou Guaraná', price: 6.00, isAvailable: true }
  ];

  for (const p of products) {
    // Verifica se já existe para não duplicar
    const exists = await prisma.product.findFirst({ where: { name: p.name } });
    if (!exists) {
      await prisma.product.create({ data: p });
    }
  }

  console.log('✅ Dados de teste inseridos com sucesso!');
}

main()
  .catch((e) => {
    console.error('Erro ao inserir dados:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });