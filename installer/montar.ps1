# Monta o instalador.
#
# O que este script produz, em ordem:
#
#   1. Uma PASTA de staging com o que roda: node.exe portavel, o dist
#      compilado, o schema e as migrations do Prisma, e o node_modules SO COM
#      O QUE O SISTEMA USA EM PRODUCAO.
#   2. O `DeliveryAdmin.exe`, compilado com o compilador C# que ja vem no
#      Windows, usando as cores do design system do painel.
#   3. (opcional) O instalador de arquivo unico, pelo IExpress.
#
# Nenhuma das tres etapas baixa nada. O `csc.exe` e' o do .NET Framework que o
# Windows traz; o `iexpress.exe` e' o proprio Windows; o `node.exe` e' uma copia
# do que ja esta instalado nesta maquina. Nao ha NSIS, Inno Setup, Electron nem
# Wix: as tres coisas que seriam de terceiros nao existem aqui.
#
# Rodar:  powershell -ExecutionPolicy Bypass -File installer\montar.ps1
# Para o instalador de arquivo unico:
#        powershell -ExecutionPolicy Bypass -File installer\montar.ps1 -Unico

[CmdletBinding()]
param(
    # Gera o instalador de arquivo unico, o que se manda para o cliente final.
    [switch]$Unico
)

# 'Stop' e' o certo para o PowerShell, e ERRADO para npm e npx: os dois escrevem
# aviso em stderr -- o "caniuse-lite is outdated" do Tailwind, entre outros -- e o
# PowerShell transforma stderr de programa nativo em erro terminante. O build
# parava no primeiro aviso, com saida de sistema em vez de codigo de retorno.
# Entao o erro e' conferido pelo `$LASTEXITCODE`, que e' o que diz a verdade.
$ErrorActionPreference = 'Continue'

$env:Path = "C:\Program Files\nodejs;$env:Path"

$raiz = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $raiz 'installer\payload'
$saida = Join-Path $raiz 'installer\dist'

Write-Host ''
Write-Host '  Montando o instalador do DeliveryAdmin'
Write-Host '  ====================================='
Write-Host ''

# --------------------------------------------------------------- 1. limpeza
Write-Host '  [1/5] limpando o que era da montagem anterior'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
if (Test-Path $saida) { Remove-Item $saida -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path $saida | Out-Null

# -------------------------------------------------- 2. compilacao do projeto
Write-Host '  [2/5] compilando o sistema'
Push-Location $raiz
try {
    & npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou.' }
} finally {
    Pop-Location
}
if (-not (Test-Path (Join-Path $raiz 'dist\server.js'))) {
    throw 'dist\server.js nao apareceu depois da compilacao.'
}
Write-Host '        ok'

# -------------------------------------------- 3. dependencias so de producao
# Esta e' a etapa que decide o tamanho do instalador. O `node_modules` de
# desenvolvimento tem 765 MB, e o grosso disso e' ferramenta que so e' usada para
# COMPILAR: o compilador do TypeScript, o do Tailwind, o do Prisma CLI, o
# empacotador do tsx. Nada disso roda no computador de quem usa o sistema.
#
# `--omit=dev` fica com o que o `package.json` marca como dependencia normal. O
# que sobra e' o Express, o Baileys, o pino, o zod, o qrcode e o cliente do
# Prisma -- mais o motor do banco para Windows, que e' um binario de 18 MB e
# nao tem como ser substituido por JS.
Write-Host '  [3/5] baixando as dependencias de PRODUCAO (pode demorar)'
$tempDeps = Join-Path $env:TEMP ("wa-deps-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tempDeps | Out-Null
Copy-Item (Join-Path $raiz 'package.json') $tempDeps
Copy-Item (Join-Path $raiz 'package-lock.json') $tempDeps -ErrorAction SilentlyContinue
# O schema vai junto porque o `prisma generate` le `DATABASE_URL` de la. O valor
# e' o mesmo do .env do projeto, e o que importa aqui e' que o comando roda.
Copy-Item (Join-Path $raiz 'prisma') $tempDeps -Recurse
if (Test-Path (Join-Path $raiz '.env')) { Copy-Item (Join-Path $raiz '.env') $tempDeps }

# O `postinstall` do package.json chama `scripts/postinstall.mjs`, e sem a pasta
# ele falha com MODULE_NOT_FOUND -- derrubando o `npm install` inteiro. A pasta
# vai junto so por causa desse script; nada dela entra no instalador.
New-Item -ItemType Directory -Force -Path (Join-Path $tempDeps 'scripts') | Out-Null
Copy-Item (Join-Path $raiz 'scripts\postinstall.mjs') (Join-Path $tempDeps 'scripts')

Push-Location $tempDeps
try {
    & npm install --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'npm install --omit=dev falhou.' }

    # O cliente gerado do Prisma. Sem isto, `dist` roda e nao acha o motor.
    & npx prisma generate 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'prisma generate falhou.' }
} finally {
    Pop-Location
}

Write-Host '        ok'

# -------------------------------------------------- 4. montagem do payload
Write-Host '  [4/5] montando a pasta do programa'
$pastaRuntime = Join-Path $staging 'runtime'
New-Item -ItemType Directory -Force -Path $pastaRuntime | Out-Null

# O Node vai COPIADO. E' o que faz o computador de quem instala nao precisar de
# Node: o programa carrega o proprio runtime e ninguem precisa instalar nada.
Copy-Item 'C:\Program Files\nodejs\node.exe' $pastaRuntime

Copy-Item (Join-Path $raiz 'dist') (Join-Path $staging 'dist') -Recurse
Copy-Item (Join-Path $raiz 'prisma') (Join-Path $staging 'prisma') -Recurse
if (Test-Path (Join-Path $raiz 'public')) {
    Copy-Item (Join-Path $raiz 'public') (Join-Path $staging 'public') -Recurse
}
Copy-Item (Join-Path $tempDeps 'node_modules') (Join-Path $staging 'node_modules') -Recurse

# O Prisma CLI precisa estar no payload, e so a versao install. O resto das
# ferramentas de desenvolvimento nao.
$cli = Join-Path $tempDeps 'node_modules\prisma'
if (Test-Path $cli) {
    Write-Host '        (incluindo o Prisma CLI, que roda a migracao na instalacao)'
} else {
    throw 'O Prisma CLI nao veio na instalacao de producao; a migracao do banco vai falhar.'
}

# ------------------------------------------------- 4b. enxugando o payload
#
# Nao e' enfeite: 71 MB a menos no instalador e, mais importante, 71 MB a menos
# copiados para o disco do cliente a cada instalacao ou atualizacao.
#
# As duas coisas cortadas sao as unicas que o Windows x86-64 nao usa, e ambas
# sao copia de outra coisa que JA esta no payload. Nenhuma delas e' lida em
# tempo de execucao -- sao o cache de download e os binarios de Linux, macOS e
# ARM, que num Windows nao tem como ser chamados.
$engines = Join-Path $staging 'node_modules\@prisma\engines'
$cache = Join-Path $staging 'node_modules\.cache'

if (Test-Path $cache) {
    $m = (Get-ChildItem $cache -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum
    Remove-Item $cache -Recurse -Force
    Write-Host ('        - cache de download do Prisma: {0:N0} MB' -f ($m / 1MB))
}

if (Test-Path $engines) {
    $m = 0
    $removidos = 0
    # So os BINARIOS de outras plataformas. O filtroanticamente era
    # "todo arquivo que nao tem 'windows' no nome", e ele levava junto o
    # `package.json` do pacote -- 2 KB, arredondados para 0 MB no log. Sem o
    # `package.json`, o Node deixa de resolver o pacote inteiro, e o
    # `prisma migrate deploy` morre com "Cannot find module '@prisma/engines'".
    # Foi o primeiro erro de verdade do instalador, e ele se annunciou como
    # "detalhe: sem detalhe".
    Get-ChildItem $engines -File -Force |
        Where-Object { $_.Name -match '^(query_engine|schema-engine|libquery-engine)' -and $_.Name -notmatch 'windows' } |
        ForEach-Object {
            $m += $_.Length
            $removidos++
            Remove-Item $_.FullName -Force
        }
    if ($removidos -gt 0) {
        Write-Host ('        - binarios de outras plataformas: {0} arquivo(s), {1:N1} MB' -f $removidos, ($m / 1MB))
    }

    # A prova de que o corte nao levou o pacote junto. Sem este teste, o
    # instalador "passa" e so quebra na maquina de quem install, no meio da
    # preparacao do banco.
    if (-not (Test-Path (Join-Path $engines 'package.json'))) {
        throw 'O corte de binarios levou o package.json de @prisma/engines. O payload esta quebrado.'
    }
}

Remove-Item $tempDeps -Recurse -Force -ErrorAction SilentlyContinue

# O manifesto NAO entra no payload: ele ja foi embutido no .exe na etapa de
# compilacao, pelo `/win32manifest`. Copiar o arquivo aqui deixaria um
# `app.manifest` solto na pasta do programa, sem ninguem o usando.

$tam = (Get-ChildItem $staging -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ('        payload: {0:N0} MB' -f ($tam / 1MB))


# ------------------------------------------------------- 5. compilando o C#
Write-Host '  [5/5] compilando o programa de instalacao'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw 'Nao achei o compilador C# do .NET Framework no Windows.'
}

# O manifesto e' conferido ANTES de compilar.
#
# Nao e' paranoia: um manifesto com XML invalido produz um .exe que o Windows
# recusa ABRIR, com "falha na inicializacao do aplicativo devida a configuracao
# lado a lado incorreta". A mensagem nao fala de manifesto, nao fala de XML e nao
# diz a linha. O compilador aceita o arquivo sem reclamar -- ele so copia os
# bytes -- entao o defeito so aparece na mao de quem foi instalar, que e' o pior
# lugar possivel para descobrir que faltava uma virgula.
#
# A causa real que passou por aqui: um comentario com dois hifens seguidos, o que
# XML proibe. O sintoma era identico ao de um manifesto que nem existia.
$manifesto = Join-Path $PSScriptRoot 'app.manifest'
try {
    [xml]$confere = Get-Content $manifesto -Raw
    $nivel = $confere.DocumentElement.trustInfo.security.requestedPrivileges.requestedExecutionLevel.level
    if ($nivel -ne 'requireAdministrator') {
        throw "o manifesto pede '$nivel', e nao requireAdministrator"
    }
    if (-not $confere.DocumentElement.dependency) {
        throw 'o manifesto esta sem a dependencia de Common Controls, que e' o que faz o .exe nao abrir'
    }
    Write-Host '        manifesto ok (XML valido, pede administrador, com dependencia)'
} catch {
    throw "O manifesto esta invalido: $($_.Exception.Message)"
}

$exe = Join-Path $saida 'DeliveryAdmin.exe'
$icone = Join-Path $PSScriptRoot 'DeliveryAdmin.ico'
if (-not (Test-Path $icone)) {
    Write-Host '        (aviso: sem icone; rode installer\gerar-icone.ps1 para o programa ter identidade)'
    & $csc /nologo /target:winexe /optimize+ /platform:x64 /win32manifest:"$PSScriptRoot\app.manifest" `
        /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
        /out:"$exe" "$PSScriptRoot\DeliveryAdmin.cs"
} else {
    & $csc /nologo /target:winexe /optimize+ /platform:x64 /win32manifest:"$PSScriptRoot\app.manifest" /win32icon:"$icone" `
        /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
        /out:"$exe" "$PSScriptRoot\DeliveryAdmin.cs"
}

if ($LASTEXITCODE -ne 0) { throw 'A compilacao do DeliveryAdmin.exe falhou.' }
Write-Host '        ok'

# --------------------------------------------------- 6. instalador de arquivo unico
if ($Unico) {
    Write-Host ''
    Write-Host '  Montando o instalador para distributing'

    # POR QUE UM ZIP, E NAO UM .EXE UNICO
    #
    # O caminho do .exe unico foi tentado em duas vias, ambas nativas do Windows,
    # e nenhuma serviu:
    #
    #   - IExpress empacota arquivos um a um, listados num arquivo de texto. Sao
    #     4.500 arquivos no payload. Alem do arquivo de texto enorme, ele abre a
    #     janela de interface e falha sozinho com um pacote desse tamanho.
    #   - makecab nao expande curinga em linha de comando, e o formato de
    #     diretivas dele exige a lista de arquivos gerada um a um.
    #
    # O que funciona e vem do proprio Windows: `Compress-Archive`, do PowerShell.
    # O cliente recebe UM arquivo, extrai e da dois cliques. E o `DeliveryAdmin.exe`
    # descompacta o programa.zip sozinho e mostra uma janela de preparo, entao o
    # unico trabalho de quem instala e extrair, que todo mundo ja sabe fazer.
    Write-Host '    compactando o programa'
    $zip = Join-Path $saida 'programa.zip'
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -CompressionLevel Optimal
    Write-Host ('    programa.zip: {0:N0} MB' -f ((Get-Item $zip).Length / 1MB))

    # O ZIP de entrega leva o .exe junto com o programa.zip. O .exe e' o unico
    # arquivo que a pessoa precisa apertar.
    $palco = Join-Path $saida 'entrega'
    if (Test-Path $palco) { Remove-Item $palco -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $palco | Out-Null
    Copy-Item $exe $palco
    Move-Item $zip (Join-Path $palco 'programa.zip')

    $unico = Join-Path $saida 'Instalar DeliveryAdmin.zip'
    if (Test-Path $unico) { Remove-Item $unico -Force }
    Compress-Archive -Path (Join-Path $palco '*') -DestinationPath $unico -CompressionLevel Optimal
    Remove-Item $palco -Recurse -Force

    Write-Host ''
    Write-Host '  Para instalar: extraia o ZIP e de dois cliques em DeliveryAdmin.exe.'
    Write-Host ('  Instalador: {0}' -f $unico)
    Write-Host ('  Tamanho: {0:N0} MB' -f ((Get-Item $unico).Length / 1MB))
}

Write-Host ''
Write-Host '  Pronto.'
Write-Host ''
Write-Host '  O programa gerado:'
Write-Host ('    ' + $exe)
Write-Host ''
Write-Host '  Para testar a instalacao de verdade, rode o .exe: ele cria a pasta em'
Write-Host '  C:\Program Files, os atalhos e a entrada em "Apps installed".'
Write-Host ''
