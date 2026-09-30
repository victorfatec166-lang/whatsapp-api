; ---------------------------------------------------------------------------
; DeliveryAdmin -- instalador para Windows
;
; POR QUE INNO SETUP E NAO UM INSTALADOR PROPRIO
;
; Este arquivo existia para ser compilado na mao, em C#, e funcionava. Mas
; "funcionava" e' o que se diz de um caminho que ainda nao foi longe: um `.exe`
; unico compactado, barra de progresso de verdade, permissao de administrador,
; atalho, entrada em "Apps instalados" e um desinstalador de verdade sao anos de
; trabalho que o Inno ja tem pronto e testado. Reescrever isso na mao seria
; recriar, pior, o que existe pronto.
;
; A tentativa anterior de fazer isso com IExpress falhou -- e o motivo esta'
; anotado em `montar.ps1`: o IExpress empacota arquivos um a um, listados num
; texto. Sao 4.500 arquivos. Ele nao aguenta.
;
; DIVISAO DO TRABALHO
;
; O Inno copia os arquivos, faz os atalhos e registra o desinstalador. Ele nao
; sabe falar com banco de dados, entao quem configura e' o proprio programa:
; depois de instalar, o Inno chama `DeliveryAdmin.exe --pos-instalacao`, que
; escreve o `.env`, cria a pasta de dados, roda as migracoes e sobe o servidor.
;
; POR QUE O PROGRAMA FICA EM "Program Files" E O BANCO EM "%APPDATA%"
;
; Sao duas coisas diferentes de proposito. O programa e' codigo: pode ser
; trocado a cada atualizacao. O banco, a sessao do WhatsApp, os backups e os
; logs sao do dono: nunca sao tocados por uma atualizacao nem por uma
; desinstalacao. Se o Windows for formatado, o `Backup` da tela de Faturamento
; leva tudo o que importa.
; ---------------------------------------------------------------------------

#define Versao "1.0.0"
#define Nome "DeliveryAdmin"
#define Exec "{app}\DeliveryAdmin.exe"

[Setup]
AppId={{4C7B1E52-9A3D-4F18-B6C2-8D5E1A7F0C93}
AppName={#Nome}
AppVersion={#Versao}
AppPublisher=DeliveryAdmin
DefaultDirName={autopf}\{#Nome}
DefaultGroupName={#Nome}
DisableProgramGroupPage=yes
; `OutputDir` e' relativo ao arquivo .iss, e este .iss mora em `installer\`.
; `..\dist` por isso aponta para `D:\whatsapp-api\dist` -- que e' a MESMA pasta
; onde `npm run build` deixa o servidor compilado. Escrever o instalador la
; dentro nao e' problema porque `dist` so recebe arquivos de `tsc`/Tailwind, e o
; nome do instalador nunca colide com nenhum deles. A alternativa seria
; `..\installer\dist`, que e' onde os artefatos antigos de teste moravam e que
; ja estava sendo limpo a mao.
OutputBaseFilename=Instalar DeliveryAdmin
OutputDir=..\dist
SetupIconFile=DeliveryAdmin.ico
UninstallDisplayIcon={app}\DeliveryAdmin.exe
UninstallDisplayName={#Nome}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; O instalador roda a copia antiga ANTES de sobrescrever, e e' essa copia que
; volta se algo der errado. Ver `RestauraVersaoAnterior`, no DeliveryAdmin.cs.
CloseApplications=yes
CloseApplicationsFilter=DeliveryAdmin.exe,node.exe
RestartApplications=no

; Sutil: rodando a instalacao pela segunda vez, o Windows oferece "Reparar" e
; "Remover" em vez de instalar de novo por cima. Quem usa isso e' a pessoa que
; vai atualizar, e as duas acoes fazem exatamente o que ela espera.
[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

[Languages]
Name: "portugues"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "icones"; Description: "Criar atalho na &Area de Trabalho"; GroupDescription: "Atalhos:"; Flags: checkedonce
Name: "iniciar"; Description: "Iniciar o DeliveryAdmin quando o Windows abrir"; GroupDescription: "Inicializacao:"; Flags: checkedonce

[Files]
; O payload ja vem com `node.exe` dentro, em `runtime`. E' ele que dispensa o
; cliente de instalar o Node, e e' por isso que o instalador tem 100 MB e nao
; 2 MB: o runtime viaja junto.
Source: "payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\DeliveryAdmin.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#Nome}"; Filename: "{#Exec}"; Parameters: "--iniciar"; WorkingDir: "{app}"; Comment: "Abre o painel"
Name: "{group}\Desinstalar {#Nome}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#Nome}"; Filename: "{#Exec}"; Parameters: "--iniciar"; WorkingDir: "{app}"; Tasks: icones; Comment: "Abre o painel"

; Nada nesta secao.
;
; A entrada em "Apps instalados" e' criada pelo proprio Inno, com o `AppId`
; acima. Escrever a chave na mao foi um erro: ela ia para o HKLM, que exige
; permissao de administrador, entao numa instalacao comum a chave simplesmente
; nao aparecia -- e a pessoa nao tinha como desinstalar pelo Windows.

[Run]
; `--destino {app}` e' obrigatorio, e nao opcional. O Inno deixa a pasta de
; instalacao a escolha da pessoa, e o `.exe` nao tem como adivinhar: sem esse
; parametro ele procura em "C:\Program Files\DeliveryAdmin", nao acha o Prisma,
; e a instalacao termina dando a impressao de que o instalador veio quebrado.
;
; A opcao de "iniciar junto com o Windows" e' lida da lista de tarefas, e o
; Inno so escreve o registro DEPOIS do "[Run]" -- por isso a opcao viaja por
; parametro em vez de ser consultada.
Filename: "{#Exec}"; Parameters: "--pos-instalacao --destino ""{app}""{code:OpcaoIniciar}"; WorkingDir: "{app}"; StatusMsg: "Preparando o banco e abrindo o painel..."; Flags: runhidden

[UninstallDelete]
; A pasta do programa inteira. A pasta de dados NAO entra aqui, e essa e' a
; parte importante: `%APPDATA%\DeliveryAdmin` e' do dono, e sobrevive a uma
; desinstalacao para que reinstalar nao apague o historico de pedidos.
Type: filesandordirs; Name: "{app}"

[Code]
function OpcaoIniciar(Param: string): string;
begin
  Result := '';
  if WizardIsTaskSelected('iniciar') then Result := ' --iniciar-sozinho';
end;
