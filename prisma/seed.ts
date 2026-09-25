import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.product.createMany({
    data: [
      {
        name: 'Marmita P - Bife acebolado',
        description: 'Arroz, feijão, bife acebolado, batata frita e salada.',
        price: 18.0,
        isAvailable: true
      },
      {
        name: 'Marmita M - Frango Grelhado',
        description: 'Arroz, feijão, filé de frango, purê de batata e salada.',
        price: 22.0,
        isAvailable: true
      },
      {
        name: 'Marmita G - Feijoada Completa',
        description: 'Feijoada tradicional, couve, farofa, torresmo e salada.',
        price: 28.0,
        isAvailable: true
      }
    ]
  });

  console.log('✅ Produtos de teste cadastrados com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });