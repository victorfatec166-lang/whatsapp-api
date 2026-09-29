-- Lembrete do dia no calendario.
--
-- Duas colunas com nome de data e' o schema de referencia: `date` e' o dia a que
-- o lembrete pertence (meia-noite local) e `createdAt` e' quando a pessoa
-- anotou. Sao coisas diferentes de proposito: o lembrete pode ser anotado hoje
-- para amanha, e e' por isso que a ordenacao da lista usa `createdAt` e o
-- recorte usa `date`.
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Um indice so, que e' a consulta da tela: os lembretes de um mes, bring os
-- nao concluidos mais antigos primeiro. O recorte por `date` e' o prefixo do
-- indice, entao a lista do mes inteiro sai em ordem sem ordenar nada depois.
CREATE INDEX "Reminder_date_done_idx" ON "Reminder"("date", "done");
