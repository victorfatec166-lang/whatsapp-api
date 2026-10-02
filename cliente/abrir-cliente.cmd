@echo off
rem Atalho para o cliente de desktop do DeliveryAdmin.
rem Caminho absoluto de proposito: atalho com caminho relativo quebra quando a pasta
rem e' movida, e o duplo clique viraria "nao foi possivel localizar o aplicativo".
rem
rem O painel mora na NUVEM, entao o cliente abre a URL da nuvem. Antes ele caia
rem sempre em http://localhost:3000 -- que so responde com o servidor rodando nesta
rem maquina -- e a janela ficava invisivel, sem explicacao nenhuma.
rem
rem Para developing local, chame este arquivo passando "local":
rem     abrir-cliente.cmd local
setlocal
set "ELETRON=D:\whatsapp-api\node_modules\electron\dist\electron.exe"
if not exist "%ELETRON%" (
    echo Electron nao encontrado em %ELETRON%.
    echo Rode "npm install" em D:\whatsapp-api e tente de novo.
    pause
    exit /b 1
)

if /i "%~1"=="local" (
    set "DELIVERYADMIN_URL=http://localhost:3000/admin"
) else (
    set "DELIVERYADMIN_URL=https://whatsapp-api-7zra.onrender.com/admin"
)

start "" "%ELETRON%" "D:\whatsapp-api\cliente"