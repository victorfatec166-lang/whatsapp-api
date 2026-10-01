; DeliveryAdmin -- instalador para Windows pelo Inno Setup: ele entrega arquivo unico,
; progresso, permissao de administrador, atalho e desinstalador. Copia os arquivos; quem
; configura e' o proprio `DeliveryAdmin.exe`, chamado por `--pos-instalacao` no fim.

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
; `OutputDir` e' relativo ao .iss, que mora em `installer\`: `..\release` aponta para a raiz
; do produto. NUNCA na pasta `dist`: e' a mesma que o `npm run build` limpa antes de
; compilar, e o `.exe` sumia do disco sem aviso.
OutputBaseFilename=Instalar DeliveryAdmin
OutputDir=..\release
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

; Nada nesta secao: a entrada em "Apps instalados" sai do proprio Inno, pelo `AppId` acima.
; Escrever a chave na mao ia para o HKLM, que exige administrador -- numa instalacao comum a
; chave nao aparecia e a pessoa nao tinha como desinstalar pelo Windows.

[Run]
; `--destino {app}` e' obrigatorio: o Inno deixa a pessoa escolher a pasta e o `.exe` nao
; adivinha -- sem ele nao acha o Prisma e a instalacao parece quebrada. A opcao de iniciar
; tambem vai por parametro: o Inno so escreve o registro DEPOIS do "[Run]".
Filename: "{#Exec}"; Parameters: "--pos-instalacao --destino ""{app}""{code:OpcaoIniciar}"; WorkingDir: "{app}"; StatusMsg: "Preparando o banco e abrindo o painel..."; Flags: runhidden

[UninstallDelete]
; A pasta do programa inteira; a de dados NAO entra. Codigo pode ser trocado a cada
; atualizacao, dado e' do dono: `%APPDATA%\DeliveryAdmin` sobrevive a desinstalacao para
; que reinstalar nao apague o historico de pedidos.
Type: filesandordirs; Name: "{app}"

[Code]
function OpcaoIniciar(Param: string): string;
begin
  Result := '';
  if WizardIsTaskSelected('iniciar') then Result := ' --iniciar-sozinho';
end;
