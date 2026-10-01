@echo off
rem Atalho para o cliente de desktop do DeliveryAdmin.
rem Caminho absoluto de proposito: atalho com caminho relativo quebra quando a pasta
rem e' movida, e o duplo clique viraria "nao foi possivel localizar o aplicativo".
setlocal
set "ELETRON=D:\whatsapp-api\node_modules\electron\dist\electron.exe"
if not exist "%ELETRON%" (
    echo Electron nao encontrado em %ELETRON%.
    echo Rode "npm install" em D:\whatsapp-api e tente de novo.
    pause
    exit /b 1
)
start "" "%ELETRON%" "D:\whatsapp-api\cliente"