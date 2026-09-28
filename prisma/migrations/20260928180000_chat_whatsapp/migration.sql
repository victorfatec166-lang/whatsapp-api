-- Chat e Message: historico de conversa do WhatsApp.
--
-- Nao existia nenhuma das duas. Toda mensagem recebida era respondida pelo bot
-- e descartada, e o userSession guardava so o passo do menu, em memoria. Sem
-- historico, a aba de chat seria um cliente de e-mail sem as mensagens: dava
-- para escrever, mas nao para saber o que o cliente ja contou.
--
-- O "atendente" na Chat e' o que impede bot e pessoa de atropelarem o mesmo
-- cliente: enquanto vale 'bot', o bot responde; quando alguem assume, o bot
-- cala ate devolver.

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "atendente" TEXT NOT NULL DEFAULT 'bot',
    "ultimaMensagem" TEXT NOT NULL DEFAULT '',
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assumidoAt" DATETIME,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "falhou" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- O telefone e unico porque uma conversa e' por numero. O jid do Baileys inclui
-- o dominio, entao o mesmo numero em outra conta nao colide.
CREATE UNIQUE INDEX "Chat_phone_key" ON "Chat"("phone");

-- A lista de conversas ordena por recencia, e nao por nome: quem atende precisa
-- ver primeiro a que chegou por ultimo.
CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");

-- O historico se le em ordem cronologica de uma conversa so.
CREATE INDEX "Message_chatId_sentAt_idx" ON "Message"("chatId", "sentAt");
