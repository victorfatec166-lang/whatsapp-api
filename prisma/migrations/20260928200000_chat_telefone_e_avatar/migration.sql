-- Telefone legivel e foto do perfil na conversa.
--
-- A tela mostrava "192479311741143@lid" como se fosse o numero do cliente. Nao
-- e': o WhatsApp passou a entregar mensagens por um identificador de
-- privacidade, o LID, que nao contem telefone. Enviar pelo lid funciona, e por
-- isso `phone` continua sendo o endereco de envio -- mudar isso seria trocar
-- algo que funciona.
--
-- O que faltava era guardar as duas coisas que o dono precisa ver: o numero de
-- verdade (`telefone`) e a foto do perfil (`avatarUrl`, com `avatarAt`
-- controlling quando ela foi buscada pela ultima vez).
--
-- Ambas sao NULL enquanto o WhatsApp nao entregar a correspondencia. A tela mostra
-- o endereco marcado como nao identificado em vez de inventar um numero: um
-- telefone errado no meio de um atendimento custa mais que um telefone faltando.

-- Redefine a tabela "Chat"
CREATE TABLE "new_Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "telefone" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "avatarAt" DATETIME,
    "atendente" TEXT NOT NULL DEFAULT 'bot',
    "ultimaMensagem" TEXT NOT NULL DEFAULT '',
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assumidoAt" DATETIME,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Chat" ("id", "phone", "telefone", "name", "avatarUrl", "avatarAt", "atendente", "ultimaMensagem", "naoLidas", "lastMessageAt", "assumidoAt", "orderId", "createdAt", "updatedAt")
SELECT "id", "phone", NULL, "name", NULL, NULL, "atendente", "ultimaMensagem", "naoLidas", "lastMessageAt", "assumidoAt", "orderId", "createdAt", "updatedAt"
FROM "Chat";

DROP TABLE "Chat";

ALTER TABLE "new_Chat" RENAME TO "Chat";

CREATE UNIQUE INDEX "Chat_phone_key" ON "Chat"("phone");

CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");
