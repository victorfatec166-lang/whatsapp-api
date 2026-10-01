# Monta o instalador: staging com o que roda, o configurador C# e o `DeliveryAdmin.exe` de
# arquivo unico que o Inno Setup gera em `release\Instalar DeliveryAdmin.exe`. O Inno ja
# entrega progresso, permissao de administrador e desinstalador.

[CmdletBinding()]
param()

# npm e npx escrevem aviso em stderr e o PowerShell trata stderr de nativo como erro
# terminante: o build parava no primeiro aviso. O erro e' conferido pelo `$LASTEXITCODE`.
$ErrorActionPreference = 'Continue'

$env:Path = "C:\Program Files\nodejs;$env:Path"

$raiz = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $raiz 'installer\payload'
# Onde o configurador C# vai ficar: e' ENTRADA do Inno Setup, nao entrega -- a entrega e' a
# pasta `release\`. Antes os dois papeis viviam em `installer\dist`, que ninguem produzia, e a
# emenda so fechava porque alguem copiava o arquivo na mao.
$buildDir = Join-Path $raiz 'installer\build'
$saida = Join-Path $raiz 'release'
# Resquicio da via ZIP, morta em favor do Inno. Apagada uma vez aqui para o
# resumo de 101 MB de `Compress-Archive` nao ficar para sempre no disco.
$zipAntigo = Join-Path $raiz 'installer\dist'

Write-Host ''
Write-Host '  Montando o instalador do DeliveryAdmin'
Write-Host '  ====================================='
Write-Host ''

# --------------------------------------------------------------- 1. limpeza
Write-Host '  [1/6] limpando o que era da montagem anterior'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
if (Test-Path $zipAntigo) { Remove-Item $zipAntigo -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
New-Item -ItemType Directory -Force -Path $saida | Out-Null

# -------------------------------------------------- 2. compilacao do projeto
Write-Host '  [2/6] compilando o sistema'
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
# Decide o tamanho: o `node_modules` de desenvolvimento tem 765 MB e o grosso e' ferramenta
# que so COMPILA. Fica o Express, o Baileys e o motor do banco, binario de 18 MB sem troca.
Write-Host '  [3/6] baixando as dependencias de PRODUCAO (pode demorar)'
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
Write-Host '  [4/6] montando a pasta do programa'
$pastaRuntime = Join-Path $staging 'runtime'
New-Item -ItemType Directory -Force -Path $pastaRuntime | Out-Null

# O Node vai COPIADO. E' o que faz o computador de quem instala nao precisar de
# Node: o programa carrega o proprio runtime e ninguem precisa instalar nada.
Copy-Item 'C:\Program Files\nodejs\node.exe' $pastaRuntime

Copy-Item (Join-Path $raiz 'dist') (Join-Path $staging 'dist') -Recurse
# O `prisma\` vai SO com schema e migrations: o `dev.db` da raiz NAO entra. E' inerte -- o
# instalado le `DATABASE_URL` de %APPDATA% -- mas sao 356 KB do banco de DESENVOLVIMENTO
# com telefones de teste, legiveis por qualquer programa na maquina de quem instalou.
$prismaDestino = Join-Path $staging 'prisma'
New-Item -ItemType Directory -Force -Path $prismaDestino | Out-Null
Copy-Item (Join-Path $raiz 'prisma\schema.prisma') $prismaDestino
if (Test-Path (Join-Path $raiz 'prisma\migrations')) {
    Copy-Item (Join-Path $raiz 'prisma\migrations') $prismaDestino -Recurse
}
if (Test-Path (Join-Path $raiz 'public')) {
    Copy-Item (Join-Path $raiz 'public') (Join-Path $staging 'public') -Recurse
}
Copy-Item (Join-Path $tempDeps 'node_modules') (Join-Path $staging 'node_modules') -Recurse

$cli = Join-Path $tempDeps 'node_modules\prisma'
if (Test-Path $cli) {
    Write-Host '        (incluindo o Prisma CLI, que roda a migracao na instalacao)'
} else {
    throw 'O Prisma CLI nao veio na instalacao de producao; a migracao do banco vai falhar.'
}

# ------------------------------------------------- 4b. enxugando o payload
# Nao e' enfeite: 71 MB a menos no instalador e 71 MB a menos copiados para o disco do
# cliente a cada instalacao. Sai cache de download e binarios de Linux, macOS e ARM.
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
    # So os BINARIOS de outras plataformas. O filtro `sem windows no nome` tambem levava o
    # `package.json` do pacote, e sem ele o `prisma migrate deploy` morre com `Cannot find
    # module '@prisma/engines'` -- sintoma de `detalhe: sem detalhe`.
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

# O `dev.db` ja foi barrado acima; este guard pega o resto do mesmo tipo. `.env`, banco e
# sessao do WhatsApp nao viajam: o instalador levaria dado de desenvolvimento para dentro
# de "Program Files", legivel por qualquer programa rodando com a conta de quem instalou.
$vazamento = Get-ChildItem $staging -Recurse -File -Force |
    Where-Object {
        $_.Name -eq '.env' -or
        $_.Name -match '\.db(-journal|-wal|-shm)?$' -or
        $_.Name -eq 'sessao-maquina.json' -or
        $_.DirectoryName -match 'auth_info_baileys'
    }
if ($vazamento) {
    $nomes = ($vazamento | Select-Object -First 8 | ForEach-Object { $_.FullName.Replace($staging + '\', '') }) -join ', '
    throw "Dado de desenvolvimento entrou no instalador: $nomes. O `.env`, o banco e a sessao do WhatsApp nao podem viajar no payload."
}
Write-Host '        (conferido: nenhum dado de desenvolvimento no payload)'

$tam = (Get-ChildItem $staging -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ('        payload: {0:N0} MB' -f ($tam / 1MB))


# ------------------------------------------------------- 5. compilando o C#
Write-Host '  [5/6] compilando o programa de instalacao'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw 'Nao achei o compilador C# do .NET Framework no Windows.'
}

# O manifesto e' conferido ANTES de compilar: XML invalido produz .exe que o Windows
# recusa abrir, e a mensagem nao fala de manifesto nem de XML -- o `csc` aceita o arquivo
# sem reclamar. Ja passou por aqui um `--` duplo dentro de um comentario.
$manifesto = Join-Path $PSScriptRoot 'app.manifest'
try {
    [xml]$confere = Get-Content $manifesto -Raw
    $nivel = $confere.DocumentElement.trustInfo.security.requestedPrivileges.requestedExecutionLevel.level
    if ($nivel -ne 'requireAdministrator') {
        throw "o manifesto pede '$nivel', e nao requireAdministrator"
    }
    if (-not $confere.DocumentElement.dependency) {
        # Aspas duplas: a frase tem "e'" e apostrofo fecha a string simples, o resto da
        # linha vira comando e o arquivo inteiro deixa de fazer parse.
        throw "o manifesto esta sem a dependencia de Common Controls, que e' o que faz o .exe nao abrir"
    }
    Write-Host '        manifesto ok (XML valido, pede administrador, com dependencia)'
} catch {
    throw "O manifesto esta invalido: $($_.Exception.Message)"
}

# Vai para `installer\build\`, que e' de onde o `DeliveryAdmin.iss` le. Nao e' a
# entrega: e' intermediario, igual ao payload.
$exe = Join-Path $buildDir 'DeliveryAdmin.exe'
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


# ------------------------------------------- 6. o instalador de arquivo unico
# Payload de 4.500 arquivos e configurador ainda sao intermediario: quem gera o instalador
# de arquivo unico e' o Inno, e a conferencia do payload velho mora no script que o chama.
$compilador = Join-Path $PSScriptRoot 'compilar-instalador.ps1'
if (-not (Test-Path -LiteralPath $compilador)) {
    throw "Falta o compilador do instalador: $compilador"
}
& powershell -ExecutionPolicy Bypass -NoProfile -File $compilador
if ($LASTEXITCODE -ne 0) {
    throw 'A etapa do instalador falhou. O payload e o configurador ja ficaram prontos; o motivo esta acima.'
}
