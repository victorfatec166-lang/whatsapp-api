import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let sock: any = null;

const userSession: { [key: string]: { step: string } } = {};

// Adicionamos um parâmetro 'onOrderCreated' para receber a função de aviso do servidor
export async function startWhatsAppBot(onOrderCreated?: () => void) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }) as any,
        browser: Browsers.macOS('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📲 Leia o QR Code abaixo com o seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexão fechada. Reconectando: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                setTimeout(() => {
                    startWhatsAppBot(onOrderCreated);
                }, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot do WhatsApp conectado com sucesso!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const senderPhone = msg.key.remoteJid || '';
            const messageText =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text;

            if (!messageText) continue;

            const textLower = messageText.toLowerCase().trim();
            console.log(`📩 Mensagem de ${senderPhone}: ${textLower}`);

            if (!userSession[senderPhone]) {
                userSession[senderPhone] = { step: 'MENU' };
            }

            const currentStep = userSession[senderPhone].step;

            try {
                if (['menu', 'oi', 'ola', 'olá', '0', 'inicio', 'início'].includes(textLower)) {
                    userSession[senderPhone].step = 'MENU';
                    
                    const mainMenu = 
                        '🍔 *BEM-VINDO AO NOSSO DELIVERY* 🍕\n' +
                        '━━━━━━━━━━━━━━━━━━━━━\n' +
                        'Escolha uma opção:\n\n' +
                        '1️⃣ *Ver Cardápio e Pedir*\n' +
                        '2️⃣ *Consultar Meus Pedidos*\n' +
                        '3️⃣ *Falar com Atendente*\n\n' +
                        '👉 *Responda com o número* da opção desejada:';

                    await sock.sendMessage(senderPhone, { text: mainMenu });
                    continue;
                }

                if (currentStep === 'MENU') {
                    if (textLower === '1') {
                        const products = await prisma.product.findMany();
                        
                        if (products.length === 0) {
                            await sock.sendMessage(senderPhone, { 
                                text: '⚠️ O cardápio está vazio no momento. Cadastre produtos no painel web!' 
                            });
                            continue;
                        }

                        userSession[senderPhone].step = 'AGUARDANDO_PRODUTO';

                        let menuResponse = '🍽️ *CARDÁPIO DIGITAL* 🍽️\n';
                        menuResponse += '━━━━━━━━━━━━━━━━━━━━━\n\n';
                        
                        products.forEach((p, index) => {
                            menuResponse += `*[${index + 1}]* ${p.name}\n`;
                            menuResponse += `      💰 R$ ${p.price.toFixed(2)}\n`;
                            if (p.description) menuResponse += `      📝 ${p.description}\n`;
                            menuResponse += '\n';
                        });
                        
                        menuResponse += '━━━━━━━━━━━━━━━━━━━━━\n';
                        menuResponse += '👉 Digite o *número do produto* que deseja encomendar (ou digite *menu* para voltar):';

                        await sock.sendMessage(senderPhone, { text: menuResponse });
                    } 
                    else if (textLower === '2') {
                        const orders = await prisma.order.findMany({
                            where: { clientPhone: senderPhone },
                            orderBy: { createdAt: 'desc' }
                        });

                        if (orders.length === 0) {
                            await sock.sendMessage(senderPhone, { text: '📦 Não encontrámos pedidos recentes. Digite *1* para ver o cardápio ou *menu*.' });
                        } else {
                            let text = '📦 *OS SEUS PEDIDOS RECENTES:*\n\n';
                            orders.forEach(o => {
                                text += `- *${o.items}* (R$ ${o.total.toFixed(2)}) ➡️ Status: *${o.status.toUpperCase()}*\n`;
                            });
                            text += '\nDigite *menu* para voltar ao início.';
                            await sock.sendMessage(senderPhone, { text });
                        }
                    } 
                    else if (textLower === '3') {
                        await sock.sendMessage(senderPhone, { text: '👨‍💻 A sua solicitação foi registada. Um atendente humano irá chamá-lo em breve! Digite *menu* a qualquer momento para voltar.' });
                    } 
                    else {
                        await sock.sendMessage(senderPhone, { text: '🤖 Opção inválida. Digite *1* para ver o cardápio ou *menu* para ver as opções.' });
                    }
                } 
                else if (currentStep === 'AGUARDANDO_PRODUTO') {
                    if (!isNaN(Number(textLower))) {
                        const products = await prisma.product.findMany();
                        const index = Number(textLower) - 1;
                        
                        if (products[index]) {
                            const selected = products[index];
                            
                            const newOrder = await prisma.order.create({
                                data: {
                                    clientPhone: senderPhone,
                                    clientName: 'Cliente WhatsApp',
                                    items: `1x ${selected.name}`,
                                    total: selected.price,
                                    status: 'pendente'
                                }
                            });

                            console.log(`✅ Pedido criado com sucesso ID: ${newOrder.id}`);

                            // Dispara o aviso em tempo real para o painel web se a função existir
                            if (onOrderCreated) {
                                onOrderCreated();
                            }

                            userSession[senderPhone].step = 'MENU';

                            await sock.sendMessage(senderPhone, { 
                                text: `🎉 *Pedido Recebido com Sucesso!* \n\n` +
                                      `📦 *Item:* ${selected.name}\n` +
                                      `💵 *Total:* R$ ${selected.price.toFixed(2)}\n\n` +
                                      `O seu pedido já foi registado na cozinha! Digite *2* para consultar os seus pedidos.` 
                            });
                        } else {
                            await sock.sendMessage(senderPhone, { text: '❌ Número de produto inválido. Digite um número válido da lista ou *menu* para voltar.' });
                        }
                    } else {
                        await sock.sendMessage(senderPhone, { text: '❌ Por favor, digite apenas o *número* correspondente ao produto desejado ou digite *menu*.' });
                    }
                }
            } catch (err) {
                console.error('❌ Erro crítico ao processar mensagem do bot:', err);
                userSession[senderPhone].step = 'MENU';
                await sock.sendMessage(senderPhone, { text: '⚠️ Ocorreu um erro ao processar o seu pedido. Digite *menu* para reiniciar.' });
            }
        }
    });
}

export function getWhatsAppSocket() {
    return sock;
}

export async function sendWhatsAppMessage(remoteJid: string, text: string) {
    if (sock && remoteJid) {
        try {
            await sock.sendMessage(remoteJid, { text });
            console.log(`📤 Mensagem enviada com sucesso para ${remoteJid}`);
        } catch (error) {
            console.error(`❌ Erro ao enviar mensagem para ${remoteJid}:`, error);
        }
    } else {
        console.warn('⚠️ Socket do WhatsApp indisponível para envio.');
    }
}

export const initBot = startWhatsAppBot;