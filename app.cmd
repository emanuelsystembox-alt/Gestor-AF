@echo off
rem Liga o servidor do aplicativo do tecnico (campo/) e mostra o QR code
rem para o Expo Go. Funciona de qualquer terminal aberto na raiz do
rem projeto: todo terminal novo nasce aqui, e "npx expo start" na raiz
rem falha com "package.json does not exist" (27/09, oito vezes seguidas).
rem
rem   .\app            mesmo Wi-Fi (o jeito estavel)
rem   .\app --tunnel   pela internet, quando o ngrok estiver de pe
cd /d "%~dp0campo"
npx expo start %*
