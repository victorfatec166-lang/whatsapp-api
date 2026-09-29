@echo off
REM ===========================================================================
REM  Instalacao do painel, para a maquina do dono.
REM
REM  O que ele faz, em ordem:
REM    1. Confere o Node
REM    2. Instala as dependencias
REM    3. Cria o .env a partir do modelo, se ainda nao existir
REM    4. Gera o CHANNEL_SECRET, se faltar
REM    5. Compila
REM    6. Cria as pastas que o sistema usa
REM
REM  Pode rodar varias vezes sem estragar nada. Cada passo e' pulado quando ja
REM  esta feito.
REM ===========================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   Instalando a Marmitaria
echo   =======================
echo.

REM --- 1. Node -------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERRO] Node.js nao encontrado.
    echo.
    echo   Baixe a versao 22 ou mais nova em https://nodejs.org
    echo   e instale. Depois feche e abra esta janela de novo.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo   [ok] Node !NODEV!

REM O package.json declara "engines". O npm so avisa; aqui a checagem e' dura,
REM porque uma versao antiga falha mais tarde, dentro do Prisma, com uma
REM mensagem que nao fala de Node.
node -e "const m=require('./package.json').engines.node;const min=parseInt(m.replace(/[^\d].*/,''),10);if(process.versions.node.split('.')[0]*1<min){console.error('   [ERRO] Precisa do Node '+min+' ou mais novo. Este e o '+process.versions.node);process.exit(1)}" || (
    pause
    exit /b 1
)
echo   [ok] Versao compativel

REM --- 2. Dependencias -----------------------------------------------------
if exist node_modules (
    echo   [ok] Dependencias ja instaladas
) else (
    echo   Instalando dependencias... pode demorar alguns minutos.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERRO] A instalacao das dependencias falhou.
        pause
        exit /b 1
    )
)

REM --- 3. .env -------------------------------------------------------------
if exist .env (
    echo   [ok] .env ja existe
) else (
    copy /y ".env.example" ".env" >nul
    echo   [ok] .env criado a partir do modelo
)

REM --- 4. CHANNEL_SECRET ---------------------------------------------------
REM Gerado uma vez e nunca mais trocado: trocar torna as credenciais do
REM Mercado ilegiveis, e a conta volta para "sem credencial".
findstr /b /c:"CHANNEL_SECRET=" .env >nul
if errorlevel 1 (
    node -e "const c=require('crypto').randomBytes(32).toString('base64url');const fs=require('fs');fs.appendFileSync('.env','\n# Chave de cifra do Mercado (iFood/99Food). Gerada na instalacao.\nCHANNEL_SECRET=\"'+c+'\"\n')" && (
        echo   [ok] CHANNEL_SECRET gerado
    ) || (
        echo   [aviso] Nao foi possivel gerar o CHANNEL_SECRET.
        echo            O Mercado vai pedir a chave ate ela existir no .env.
    )
) else (
    echo   [ok] CHANNEL_SECRET ja existe
)

REM --- 5. Compilar ---------------------------------------------------------
echo   Compilando...
call npm run build
if errorlevel 1 (
    echo   [ERRO] A compilacao falhou.
    pause
    exit /b 1
)
echo   [ok] Compilado

REM --- 6. Pastas -----------------------------------------------------------
REM O sistema cria as pastas que precisa, mas criar agora deixa o dono
REM vendo que existe um backup antes de o primeiro cliente aparecer.
if not exist "backups" mkdir "backups" >nul 2>nul
if not exist "logs" mkdir "logs" >nul 2>nul
if not exist "public\uploads\produtos" mkdir "public\uploads\produtos" >nul 2>nul
echo   [ok] Pastas prontas

echo.
echo   Tudo pronto.
echo.
echo   Para subir:   npm start
echo   Para abrir:   http://localhost:3000/admin
echo.
pause
