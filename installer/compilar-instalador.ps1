# Compila o instalador de arquivo unico a partir do payload ja montado.
#
# O `ISCC.exe` recompila por cima de um payload velho sem reclamar, e o instalador sai com
# o servidor de ontem dentro: `npm run build` atualiza `dist\` e nao `installer\payload\`.

[CmdletBinding()]
param()

# O `ISCC` grava aviso em stderr como o `npm`, entao a preferencia de erro e a
# mesma do `montar.ps1`: o codigo de retorno e' conferido, e nao o stderr.
$ErrorActionPreference = 'Continue'

$raiz = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $raiz 'installer\payload'
$buildDir = Join-Path $raiz 'installer\build'
$saida = Join-Path $raiz 'release'
$iss = Join-Path $PSScriptRoot 'DeliveryAdmin.iss'
$instalador = Join-Path $saida 'Instalar DeliveryAdmin.exe'

Write-Host ''
Write-Host '  Compilando o instalador'
Write-Host '  ======================='
Write-Host ''

# ------------------------------------------------------- 1. onde esta o Inno
# O `ISCC.exe` fica em `%LOCALAPPDATA%\Programs`, que nao entra no PATH do sistema. Por
# isso a lista: so o primeiro caminho faria funcionar aqui e falhar na maquina de outro.
$possiveis = @(
    (Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).Source,
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramW6432 'Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$iscc = $possiveis | Select-Object -First 1
if (-not $iscc) {
    throw 'Nao achei o Inno Setup. Instale com: winget install JRSoftware.InnoSetup'
}
Write-Host "  [1/4] Inno Setup: $iscc"

# ------------------------------------------------ 2. o payload esta atualizado?
# Esta e' a conferencia que justifica existir deste arquivo.
$fresco = Join-Path $payload 'dist\server.js'
if (-not (Test-Path -LiteralPath $fresco)) {
    throw "O payload nao existe ainda, ou esta sem o `dist\server.js`. Rode o montar.ps1 antes: powershell -ExecutionPolicy Bypass -File installer\montar.ps1"
}

# A conferencia e' de CONTEUDO, e nao de data: `npm run build` reescreve `dist\`
# mesmo sem mudar nada, entao comparar `LastWriteTime` faz este caminho recusar
# sempre -- e build de novo nao resolve, ele adianta o `dist` outra vez.
$distDoProjeto = Join-Path $raiz 'dist'
$distDoPayload = Join-Path $payload 'dist'

function HashDeArquivo([string]$caminho) {
    # .NET direto, e nao o `Get-FileHash`, que falhou de forma intermitente dentro
    # da montagem completa. `System.Security.Cryptography` nao carrega modulo.
    $algoritmo = [System.Security.Cryptography.SHA256]::Create()
    $leitor = [System.IO.File]::OpenRead($caminho)
    try {
        return [BitConverter]::ToString($algoritmo.ComputeHash($leitor)).Replace('-', '')
    } finally {
        $leitor.Dispose()
        $algoritmo.Dispose()
    }
}

function AssinaturaDeDist([string]$pasta) {
    $arquivos = @(Get-ChildItem -LiteralPath $pasta -Recurse -File | Sort-Object FullName)
    $partes = @()
    foreach ($f in $arquivos) {
        $partes += ($f.FullName.Substring($pasta.Length) + ':' + (HashDeArquivo $f.FullName))
    }
    # Contagem como prova: um arquivo que falhou deixa a lista pela metade, e meia
    # lista nao compara com lista cheia. A mensagem traz o primeiro erro, para que
    # a causa se denuncie em vez de virar "incompleta".
    if ($partes.Count -ne $arquivos.Count) {
        $causa = if ($Error.Count) { $Error[0].Exception.Message } else { '(sem erro registrado)' }
        throw "A assinatura de '$pasta' saiu incompleta: $($partes.Count) de $($arquivos.Count). Causa: $causa"
    }
    return ($partes -join "`n")
}

if (Test-Path -LiteralPath (Join-Path $distDoProjeto 'server.js')) {
    if ((AssinaturaDeDist $distDoPayload) -ne (AssinaturaDeDist $distDoProjeto)) {
        throw ("O `dist` do payload e' diferente do `dist` do projeto (payload: {0}, projeto: {1} arquivos)." -f `
            (Get-ChildItem -LiteralPath $distDoPayload -Recurse -File).Count, `
            (Get-ChildItem -LiteralPath $distDoProjeto -Recurse -File).Count) +
        "`nO instalador sairia com o servidor de antes. Rode o montar.ps1, que baixa as dependencias e refaz o payload."
    }
}

# As tres pecas que o `.iss` le. Sem elas o ISCC ou falha, ou -- pior -- monta um
# instalador que "instala" e deixa o computador sem runtime e sem configurador.
foreach ($peca in @(
    @{ Caminho = (Join-Path $buildDir 'DeliveryAdmin.exe'); Que = 'o configurador DeliveryAdmin.exe ( rode montar.ps1 )' },
    @{ Caminho = (Join-Path $payload 'runtime\node.exe'); Que = 'o node.exe do runtime (rode montar.ps1)' },
    @{ Caminho = (Join-Path $payload 'prisma\schema.prisma'); Que = 'o schema do Prisma (rode montar.ps1)' }
)) {
    if (-not (Test-Path -LiteralPath $peca.Caminho)) {
        throw "Falta $($peca.Que) em: $($peca.Caminho)"
    }
}
Write-Host '  [2/4] payload conferido: tem runtime, schema e configurador'

# -------------------------------------------- 3. o mesmo dado proibido, de novo
# Segunda porta do `montar.ps1`: o payload pode ter vindo de outra versao do script ou de
# outra maquina, e o ISCC empacota o que encontrar sem reclamar.
$vazamento = Get-ChildItem $payload -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq '.env' -or
        $_.Name -match '\.db(-journal|-wal|-shm)?$' -or
        $_.Name -eq 'sessao-maquina.json' -or
        $_.DirectoryName -match 'auth_info_baileys'
    }
if ($vazamento) {
    $nomes = ($vazamento | Select-Object -First 8 | ForEach-Object { $_.FullName.Replace($payload + '\', '') }) -join ', '
    throw "Dado de desenvolvimento dentro do payload: $nomes. Refaca a montagem pelo montar.ps1."
}
Write-Host '  [3/4] payload limpo: nenhum .env, banco ou sessao do WhatsApp'

# ------------------------------------------------------------- 4. compilando
if (-not (Test-Path -LiteralPath $saida)) {
    New-Item -ItemType Directory -Force -Path $saida | Out-Null
}

# O `OutputDir` do `.iss` e' relativo ao `.iss`, e o arquivo mora em `installer\`.
Push-Location $PSScriptRoot
try {
    & $iscc $iss 2>&1 | ForEach-Object { "        $_" }
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($codigo -ne 0) { throw "O Inno Setup falhou (codigo $codigo)." }
if (-not (Test-Path -LiteralPath $instalador)) {
    throw "O ISCC disse que terminou, mas o instalador nao apareceu em: $instalador"
}

Write-Host ''
Write-Host '  Pronto.'
Write-Host ''
Write-Host '  O instalador para mandar ao cliente:'
Write-Host ('    ' + $instalador)
Write-Host ('    {0:N0} MB' -f ((Get-Item -LiteralPath $instalador).Length / 1MB))
Write-Host ''
Write-Host '  Para instalar de verdade, rode esse .exe: ele cria a pasta em'
Write-Host '  C:\Program Files, os atalhos e a entrada em "Apps instalados", e no fim'
Write-Host '  prepara o banco e abre o painel.'
Write-Host ''
