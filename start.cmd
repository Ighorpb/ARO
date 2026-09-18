@echo off
rem Sobe o ARO inteiro (core + desktop + voz). Usado pelo "iniciar com o Windows".
cd /d "%~dp0"
pnpm -r --parallel --no-bail run start
