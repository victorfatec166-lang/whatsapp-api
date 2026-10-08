/*
 * Prova de ponta a ponta do relay: a nuvem (Postgres, 3001) e o PC da loja (SQLite,
 * 3000). O pedido entra na nuvem pela rota publica, vira fila, e o PC puxa e grava.
 * Dois servidores de proposito: um cliente do Prisma e' de um driver so.
 */

import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { prisma } from '../src/database/prisma';
import { cifrar } from '../src/services/marketplace';
import { geraChave } from '../src/services/relay';

const RAIZ = resolve(__dirname, '..');
const NUVEM = 'http://127.0.0.1:3001';
const PC = 'http://127.0.0.1:3000';
const LOJA = 'loja-relay-teste';
const CANAL = 'ifood';
const SEGREDO_WEBHOOK = 'segredo-de-teste-do-webhook';

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const filhos: Array<{ kill(): void }> = [];
process.on('exit', () => { for (const f of filhos) { try { f.kill(); } catch {} } });

function pcLog(nome: string, env: Record<string, string>) {
    const porta = nome === 'nuvem' ? '3001' : '3000';
    const p = spawn(process.execPath, ['dist/server.js'], {
        cwd: join(RAIZ, 'cliente', nome === 'nuvem' ? 'servidor-nuvem' : 'servidor'),
        // O ambiente e' inteiro por lado: um cliente do Prisma so serve a um driver, e
        // herdar o do outrotransformaria o teste num teste de nuvem em vez de loja.
        env: { ...process.env, ...env, PORT: porta, HOST: '127.0.0.1', BOT_BOOT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const saida = join(RAIZ, 'scripts', `provar-${nome}.log`);
    const erro = join(RAIZ, 'scripts', `provar-${nome}.err`);
    writeFileSync(saida, '');
    writeFileSync(erro, '');
    p.stdout?.on('data', (d: Buffer) => { process.stdout.write(`[${nome}] ${d}`); appendFileSync(saida, d); });
    p.stderr?.on('data', (d: Buffer) => { process.stderr.write(`[${nome}!] ${d}`); appendFileSync(erro, d); });
    filhos.push(p);
    return p;
}

async function esperaAte(url: string, tentativas = 80): Promise<void> {
    for (let i = 0; i < tentativas; i++) {
        try { const r = await fetch(url); if (r.status < 500) return; } catch {}
        await espera(500);
    }
    throw new Error(`${url} nao respondeu`);
}

const todos = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const valorDe = (t: string, nome: string) => (t.split('; ').find((c) => c.startsWith(`${nome}=`)) || '').split('=')[1] || '';

/** Entra no painel e devolve os cookies -- o mesmo caminho do navegador. */
async function entra(base: string, email: string, senha: string) {
    const t = await fetch(`${base}/api/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const pre = todos(t);
    const { token } = (await t.json()) as { token: string };
    const r = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: pre },
        body: JSON.stringify({ email, senha, destino: '/admin', csrf: token }),
    });
    if (!r.ok) throw new Error(`login em ${base} falhou: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const cookie = todos(r);
    return { cookie, csrf: valorDe(cookie, 'da_csrf') };
}

async function main(): Promise<void> {
    const urlPostgres = process.env.DATABASE_URL ?? '';
    if (!urlPostgres || urlPostgres.startsWith('file:')) throw new Error('precisa do Postgres no DATABASE_URL');
    if (!existsSync(join(RAIZ, 'cliente', 'servidor', 'dist', 'server.js'))) throw new Error('rode build + montar-servidor antes');

    const dados = join(process.env.TEMP ?? '.', 'opencode', 'loja-relay');
    // Pelo `fs` do Node, sem shell: um `copy` que falha em silencio traz o banco VELHO,
    // e o teste passa a provar uma coisa que nao existe.
    rmSync(dados, { recursive: true, force: true });
    mkdirSync(join(dados, 'prisma'), { recursive: true });
    copyFileSync(join(RAIZ, 'cliente', 'banco-inicial.db'), join(dados, 'prisma', 'loja.db'));
    const urlLoja = `file:${dados.replace(/\\/g, '/')}/prisma/loja.db`;

    // 1. O PC da loja sobe. O boot cria a loja e a senha do primeiro acesso.
    pcLog('loja', { DATABASE_URL: urlLoja, MODO_LOCAL: '1', DELIVERYADMIN_DATA: dados, DELIVERYADMIN_TENANT: LOJA, DELIVERYADMIN_NUVEM: NUVEM });
    await esperaAte(`${PC}/entrar`);
    await espera(1500);
    const primeiro = JSON.parse(readFileSync(join(dados, 'primeiro-acesso.json'), 'utf8')) as { senha?: string; email?: string };
    console.log(`\n[1] PC da loja no ar. Loja ${LOJA}, admin ${primeiro.email}`);

    /*
     * A loja vira local. Quem marca e' a instalacao, nao o painel: e' o PC dela que
     * passa a puxar a fila em vez de esperar o webhook. Usa o cliente do proprio
     * pacote porque o deste processo aponta para o Postgres da nuvem.
     */
    const sqlite = new (createRequire(join(RAIZ, 'cliente', 'servidor', 'index.js'))('@prisma/client').PrismaClient)({
        datasourceUrl: urlLoja,
    });
    await sqlite.tenant.update({ where: { id: LOJA }, data: { local: true } });
    await sqlite.$disconnect();

    const provisoria = await entra(PC, primeiro.email ?? 'admin@localhost', primeiro.senha ?? '');
    console.log('[2] a loja entrou no painel');

    // A senha do primeiro acesso e' provisoria: o painel exige a troca antes de tudo,
    // e e' assim que o dono da loja entra tambem.
    const novaSenha = 'Loja#Teste2026';
    const trocou = await fetch(`${PC}/api/auth/trocar-senha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: provisoria.cookie, 'x-csrf-token': provisoria.csrf },
        body: JSON.stringify({ atual: primeiro.senha ?? '', nova: novaSenha }),
    });
    if (!trocou.ok) throw new Error(`troca de senha falhou: HTTP ${trocou.status} ${(await trocou.text()).slice(0, 120)}`);
    console.log('[3] senha do primeiro acesso trocada');

    // A troca devolve sessao nova nos cookies; e' assim que o painel segue em frente.
    const sessao = { cookie: todos(trocou), csrf: valorDe(todos(trocou), 'da_csrf') };
    if (!sessao.csrf) throw new Error('a troca de senha nao devolveu sessao nova');
    console.log('[4] a loja entrou de novo, com a senha definitiva');

    // 2. O dono cadastra um produto no catalogo dele.
    const criado = await fetch(`${PC}/api/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf },
        body: JSON.stringify({ name: 'Marmita do relay', price: 22, category: 'Geral', trackStock: true, stock: 10 }),
    });
    const corpoCriado = await criado.text();
    console.log(`[3] criacao do produto -> HTTP ${criado.status} ${corpoCriado.slice(0, 200)}`);
    const produto = JSON.parse(corpoCriado) as { id?: string };
    console.log(`[4] produto criado na loja: ${produto.id?.slice(0, 8)}`);

    // O item casado e' CATALOGO: ele aponta para o produto, que agora vive no PC. Nuvem
    // nenhuma poderia referenciar esse produto, entao quem casa o item e' a propria loja
    // -- e, do mesmo jeito, quem guarda a credencial do canal.
    const credencial = await fetch(`${PC}/api/admin/marketplace/${CANAL}/credencial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf },
        body: JSON.stringify({ segredo: 'credencial-de-teste', webhookSecret: SEGREDO_WEBHOOK }),
    });
    console.log(`[4] credencial do iFood na loja -> HTTP ${credencial.status} ${(await credencial.text()).slice(0, 120)}`);

    const casou = await fetch(`${PC}/api/admin/marketplace/${CANAL}/itens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf },
        body: JSON.stringify({ externalId: 'SKU-RELAY-1', productId: produto.id, lastPrice: 22 }),
    });
    console.log(`[4] item do iFood casado no catalogo da loja -> HTTP ${casou.status} ${(await casou.text()).slice(0, 120)}`);

    // 3. A nuvem: loja marcada local, credencial do iFood (so o segredo do HMAC) e chave.
    pcLog('nuvem', { DATABASE_URL: urlPostgres, MODO_LOCAL: '', OPS_LIGADO: '1', DELIVERYADMIN_DATA: join(dados, 'nuvem') });
    await esperaAte(`${NUVEM}/entrar`);

    await prisma.tenant.upsert({
        where: { id: LOJA },
        create: { id: LOJA, name: 'Loja do relay', ativo: true, local: true },
        update: { local: true },
    });
    await prisma.marketplaceAccount.upsert({
        where: { tenantId_channel: { tenantId: LOJA, channel: CANAL } },
        create: { tenantId: LOJA, channel: CANAL, status: 'ativo', webhookSecretEnc: cifrar(SEGREDO_WEBHOOK) },
        update: { webhookSecretEnc: cifrar(SEGREDO_WEBHOOK) },
    });
    await prisma.chaveDeLoja.deleteMany({ where: { tenantId: LOJA } });
    await prisma.pedidoEntrante.deleteMany({ where: { tenantId: LOJA } });
    const segredoRelay = await geraChave(LOJA);
    console.log('[4] nuvem pronta: loja local, credencial do iFood e chave do relay');

    // 4. A loja cola a chave que o dono gerou.
    const colou = await fetch(`${PC}/api/admin/relay/chave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf },
        body: JSON.stringify({ chave: segredoRelay }),
    });
    console.log(`[5] loja colou a chave -> HTTP ${colou.status}`);

    // 5. O iFood manda o pedido na nuvem, assinado.
    const idPedido = `RELAY-${randomUUID().slice(0, 8)}`;
    const corpo = JSON.stringify({
        id: idPedido,
        customer: { name: 'Cliente do relay', phone: '5511900000000' },
        items: [{ sku: 'SKU-RELAY-1', name: 'Marmita do relay', quantity: 2, notes: 'sem cebola' }],
        total: 44,
    });
    const assinatura = createHmac('sha256', SEGREDO_WEBHOOK).update(corpo, 'utf8').digest('base64');
    const manda = () =>
        fetch(`${NUVEM}/webhook/marketplace/${CANAL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': assinatura },
            body: corpo,
        });

    const webhook = await manda();
    console.log(`[6] webhook na nuvem -> HTTP ${webhook.status} ${(await webhook.text()).slice(0, 80)}`);

    const fila = await fetch(`${NUVEM}/api/loja/pedidos-pendentes`, { headers: { 'x-loja': LOJA, 'x-chave-loja': segredoRelay } });
    const dadosFila = (await fila.json()) as { pedidos?: Array<{ externalId: string }> };
    console.log(`[7] fila na nuvem: ${dadosFila.pedidos?.length ?? 0} item(ns), externalId=${dadosFila.pedidos?.[0]?.externalId}`);

    const naNuvem = await prisma.order.count({ where: { tenantId: LOJA } });
    console.log(`[8] pedido gravado na nuvem: ${naNuvem} (tem de ser 0 -- a loja e' local)`);

    // 6. O PC busca a fila na hora.
    const buscou = await fetch(`${PC}/api/admin/relay/buscar`, {
        method: 'POST',
        headers: { Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf },
    });
    console.log(`[9] busca no PC -> ${JSON.stringify(await buscou.json())}`);

    const pedidos = await (await fetch(`${PC}/api/admin/orders`, { headers: { Cookie: sessao.cookie } })).json() as
        Array<{ externalId?: string; total?: number }>;
    console.log(`[10] pedidos no painel da loja: ${pedidos.length} | ${JSON.stringify(pedidos[0] ?? {})}`);
    const chegouCerto = pedidos.some((p) => p.externalId === idPedido);

    const esvaziou = await (await fetch(`${NUVEM}/api/loja/pedidos-pendentes`, { headers: { 'x-loja': LOJA, 'x-chave-loja': segredoRelay } })).json() as { pedidos?: unknown[] };
    console.log(`[11] fila depois da entrega: ${esvaziou.pedidos?.length ?? 0} item(ns)`);

    // 7. Reenvio da plataforma nao pode virar pedido duplicado.
    await manda();
    await fetch(`${PC}/api/admin/relay/buscar`, { method: 'POST', headers: { Cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } });
    const depois = await (await fetch(`${PC}/api/admin/orders`, { headers: { Cookie: sessao.cookie } })).json() as unknown[];
    console.log(`[12] depois do reenvio: ${depois.length} pedido(s) no painel (tem de continuar 1)`);

    // 8. Chave errada nao entra na fila.
    const negado = await fetch(`${NUVEM}/api/loja/pedidos-pendentes`, { headers: { 'x-loja': LOJA, 'x-chave-loja': 'chave-errada' } });
    const semCabecalho = await fetch(`${NUVEM}/api/loja/pedidos-pendentes`);
    console.log(`[13] chave errada -> HTTP ${negado.status} | sem chave -> HTTP ${semCabecalho.status}`);

    // 9. As duas telas: o dono do sistema gera a chave em /ops, a loja ve o estado.
    const tela = await (await fetch(`${PC}/admin?tab=marketplace`, { headers: { Cookie: sessao.cookie } })).text();
    const temCartao = tela.includes('Este PC') && tela.includes('relayChave');
    console.log(`[14] aba iFood da loja mostra o cartao do PC: ${temCartao ? 'sim' : 'NAO'}`);

    const estado = await (await fetch(`${PC}/api/admin/relay`, { headers: { Cookie: sessao.cookie } })).json() as {
        temChave?: boolean;
        ultimaBusca?: string | null;
        ultimoRecebido?: number;
    };
    console.log(`[15] estado no PC -> ${JSON.stringify(estado)}`);

    const ops = await fetch(`${NUVEM}/api/ops/loja/${LOJA}/relay`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const novaChave = ((await ops.json()) as { chave?: string }).chave ?? '';
    // A chave nova substitui a antiga: e' assim que se corta o acesso de um PC.
    const comNova = await fetch(`${NUVEM}/api/loja/pedidos-pendentes`, { headers: { 'x-loja': LOJA, 'x-chave-loja': novaChave } });
    const comAntiga = await fetch(`${NUVEM}/api/loja/pedidos-pendentes`, { headers: { 'x-loja': LOJA, 'x-chave-loja': segredoRelay } });
    console.log(`[16] chave nova no /ops -> HTTP ${ops.status} | vale: ${comNova.status} | a antiga: ${comAntiga.status} (tem de ser 401)`);

    const passou =
        chegouCerto &&
        naNuvem === 0 &&
        (esvaziou.pedidos?.length ?? 1) === 0 &&
        depois.length === 1 &&
        negado.status === 401 &&
        temCartao &&
        estado.temChave === true &&
        Boolean(estado.ultimaBusca) &&
        comNova.status === 200 &&
        comAntiga.status === 401;
    console.log(`\nRESULTADO: ${passou ? 'OK' : 'FALHOU'}`);
    process.exit(passou ? 0 : 1);
}

main().catch((e: Error) => { console.error('\nFALHOU:', e.message || '(sem mensagem)'); console.error(e.stack); process.exit(1); });