// Temporario: a chave funciona e o modelo entende o que um cliente manda?
// Roda as frases pelo MESMO caminho do bot (src/services/ia.ts), nao por curl.
require('dotenv').config({ path: '.env' });
const { extraiComIa } = require('../dist/services/ia.js');

const CARTAO = [
    { id: 'p1', nome: 'Pastel de Queijo' },
    { id: 'p2', nome: 'Pastel de Carne' },
    { id: 'p3', nome: 'Coca-Cola Lata 350ml' },
    { id: 'p4', nome: 'Coxinha de Frango' },
    { id: 'p5', nome: 'X-Burguer' },
    { id: 'p6', nome: 'Suco de Uva 500ml' },
    {
        id: 'p7',
        nome: 'X-Salada',
        grupos: [
            {
                id: 'g1',
                nome: 'Queijos',
                maxSelect: 2,
                opcoes: [
                    { id: 'o1', nome: 'Cheddar' },
                    { id: 'o2', nome: 'Mussarela' },
                    { id: 'o3', nome: 'Prato feito' },
                ],
            },
        ],
    },
];

const FRASES = [
    'oi tudo bem? tem pastel de queijo e uma coca cola?',
    'me manda 2 coxinha de frango',
    'quero um x salada com cheddar e mussarela',
    'da pra mudar o pastel pra carne?',
    'vc é robo ou gente',
    'qual o mais barato',
    'suco de uva tem?',
    'me da um pastel de queijo bem passado',
    'cancelar tudo',
];

(async () => {
    let acertos = 0;
    for (const f of FRASES) {
        const r = await extraiComIa(f, CARTAO);
        const itens = r ? r.itens.map((i) => `${i.qtd}x ${i.nome}`).join(' + ') : 'NAO ENTENDEU';
        const extras = r && r.naoEntendidos.length ? `  (nao entendeu: ${r.naoEntendidos.join(', ')})` : '';
        if (r && r.itens.length) acertos++;
        console.log(`"${f}"\n   -> ${itens}${extras}\n`);
    }
    console.log(`itens reconhecidos: ${acertos}/${FRASES.length}`);
})();