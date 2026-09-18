# ARO

Assistente pessoal local. Claude como cérebro, roda no seu PC, aparece na tela como uma presença que pensa em voz alta.

## Estrutura

```
apps/voice     voz — Python: mic → Whisper (GPU) → hub; hub → Kokoro → caixa de som
apps/core      cérebro — Claude API (tool runner), tools locais, memória, hub WebSocket
apps/desktop   tela — Electron + React: só o orb, legendas efêmeras, sem chat
packages/shared protocolo de eventos entre core e clientes
```

Hub central: qualquer cliente (desktop, voz, celular) conecta em `ws://localhost:7777`.

## Rodar

```bash
pnpm install
cp .env.example .env   # coloca ANTHROPIC_API_KEY (ou usa `ant auth login`)
pnpm dev               # core + desktop juntos
```

Separado: `pnpm dev:core` / `pnpm dev:desktop` / `pnpm dev:voice`. Tudo junto: `pnpm dev:all`.

### Voz (uma vez)

```bash
pnpm setup:voice   # venv + deps (~1GB de CUDA) + modelos do Kokoro (~330MB)
pnpm dev:voice     # primeira vez baixa o Whisper (~1.6GB)
```

Vozes: amostras em `apps/voice/models/sample_edge_*.wav` (Edge) e `sample_pm_*.wav` (Kokoro). Troca com `ARO_EDGE_VOICE` / `ARO_TTS=kokoro`.

Precisa de Python 3.12 em `%LOCALAPPDATA%ProgramsPythonPython312` (ou `python` no PATH).
Falar: diz **"ARO"** (ou "ARO, que horas são" de uma vez), **duas palmas**, `Ctrl+Shift+Espaço` ou botão de mic. Depois que ele responde, fica ouvindo mais 4s — dá pra emendar ("e amanhã?") sem chamar de novo. Fala, pausa, ele envia sozinho. Palmas ou atalho enquanto o ARO fala interrompem.
Palmas não pegando? `ARO_CLAP_SENSITIVITY=1.5`. Disparando à toa? `0.7`, ou `ARO_CLAP_COUNT=3`. Wake word disparando com barulho? `ARO_WAKE_MODEL=small` (mais preciso, ~1s). A tela só abre quando ele detecta fala de verdade — ativação falsa vira só um bipe no canto.

Testar a UI sem gastar token: `pnpm --filter @aro/core mock` no lugar do core.

## O que ele faz hoje (fase 1)

- Conversa em PT-BR. Na tela só o orb: muda de cor/ritmo pensando, pulsa com a própria voz, anel cresce com seu mic. Pensamento e resposta aparecem como legenda e somem. Histórico fica só no core (`data/session.json`)
- Roteamento de modelo por mensagem: regras → classificador (Haiku) → tier
  - `fast` Sonnet 5 / low — hora, clima, abrir, nota, saudação
  - `main` Opus 5 / medium — conversa, explicação, pesquisa
  - `deep` Opus 5 / high — análise, código, planejamento, msg longa
- Hora, clima (Open-Meteo), notas/to-do, lembretes com horário, abrir URL/app
- Pesquisa na web (server tool)
- Voz: fala e escuta (fase 2). Whisper large-v3-turbo na GPU; voz Edge TTS (Microsoft, PT-BR natural) com Kokoro local de reserva; fala frase a frase enquanto escreve; ativa por duas palmas
- **Vê a tela** ("olha esse erro"), lê o que você copiou, controla mídia e volume, sabe qual janela está em foco, cumprimenta na primeira conversa do dia
- Memória entre sessões (`apps/core/data/memory/`)
- Histórico persistido (`apps/core/data/session.json`) com compaction automática

## Na tela

- **Orb** (WebGL): âmbar parado, azul pensando, pulsa com a própria voz, anel cresce com seu mic. Pisca, olha pro cursor, percebe você falando na sala. Tom muda com a hora do dia. 20 min parado → dorme (escurece); som ou mouse acorda.
- **Legendas**: o que ele ouviu em cima; pensamento e resposta embaixo. Resposta acende palavra por palavra sincronizada com a fala. Somem sozinhas.
- **Ferramentas** orbitam o orb enquanto rodam. **Faísca** quando ele salva algo na memória.
- **Dois modos**. Nasce *minimalista*: só o orb no canto inferior direito, o resto da tela é clicável normalmente; passa o mouse → mic + expandir; arrasta pelo orb (ele lembra onde ficou). Palma, atalho, mic, tecla ou lembrete → abre em *tela cheia* (palco, legendas, karaokê, dock); 10s depois de terminar e ficar quieto, volta pro canto sozinho. Expandiu na mão (botão ↗ ou bandeja) → fica até você fechar (duplo clique no orb).
- **Bandeja**: fechar esconde; `Ctrl+Shift+A` mostra/esconde; "Iniciar com o Windows" roda `start.cmd` (core + desktop + voz).
- **Atalhos**: `Ctrl+Shift+Espaço` falar · qualquer tecla abre o campo de texto · `Esc` fecha.

## Configuração

`.env` na raiz:

| Var | Default | O que é |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | chave da API |
| `ARO_PORT` | `7777` | porta do hub |
| `ARO_MODEL` | `claude-opus-5` | modelo |
| `ARO_EFFORT` | `medium` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| `ARO_CITY` | `São Paulo` | cidade padrão do clima |

Apps extras pra `open_app`: `apps/core/data/apps.json` → `{ "nome": "comando" }`.

## Próximas fases

3. Wake word "ARO" + conversa contínua
4. Celular — Telegram ou PWA via túnel
5. Agenda Google, controle do PC, etc.
