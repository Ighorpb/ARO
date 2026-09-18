# ARO — contexto pro Claude Code

Assistente pessoal local do Ighor. Ver `README.md` pra visão geral.

## Arquitetura

- **Hub central** (`apps/core`): servidor WS em `:7777`. Todo cliente conecta nele. Eventos em `packages/shared/src/events.ts` — mudou protocolo, muda lá primeiro.
- **Cérebro** (`apps/core/src/brain/aro.ts`): `client.beta.messages.toolRunner` com `stream: true`. Thinking `adaptive` + `display: "summarized"` (é isso que aparece na tela). Fallback server-side ligado. Compaction server-side ligada.
- **Roteador** (`apps/core/src/brain/router/`): `rules.ts` (regex + tamanho, 0ms) → `classifier.ts` (Haiku, JSON estruturado) → tier. `tiers.ts` mapeia tier → modelo/effort/betas. Fallback server-side só no Opus. Cache de prompt é por modelo — trocar tier no meio da conversa reescreve cache.
- **Corpo** (`brain/system.ts`): o core pede via `sys.request` (screen | clipboard | media) e quem sabe fazer responde `sys.result` pelo hub — desktop faz print (`desktopCapturer` com `setContentProtection(true)` pra sair da própria foto, JPEG 1568px ≈ 1.9K tokens) e clipboard; voz faz mídia/volume (teclas virtuais via ctypes) e manda `context.window` (janela em foco, a cada 2s) que vai no carimbo da mensagem. `ARO_DATA_DIR` aponta sessão/memória pra outro lugar (testes).
- **Tools** (`apps/core/src/brain/tools/`): `betaZodTool`, uma por arquivo, registradas em `index.ts`. Ordem da lista é fixa — mudar ordem invalida prompt cache. Toda tool recebe `eager_input_streaming: true`.
- **Memória**: `BetaLocalFilesystemMemoryTool` do SDK, arquivos em `apps/core/data/memory/`.
- **Voz** (`apps/voice`, Python): cliente do hub como outro qualquer. `mic.py` é o único stream do mic (sempre aberto, 20ms/frame, rastreia ruído de fundo) — `ears.py` e `clap.py` assinam ele. `ears.py` grava e corta no silêncio (energia RMS, sem VAD externo); `clap.py` detecta N impulsos curtos (palmas). `wake.py` = wake word sem serviço externo: segmenta fala curta por energia e roda Whisper `base` (GPU, ~270ms) **com VAD Silero e sem `initial_prompt`** (prompt com "aro" faz o Whisper alucinar "arô arô" em digitação/zumbido — testado), regex tolerante (`a+r+[ou]+`) porque sem prompt ele escreve "Arou/Aru"; descarta som com energia concentrada (clique) e `no_speech_prob` alto. `clap.py` exige silêncio 500ms antes e 350ms depois das palmas (digitação = vários impulsos) e amplitude ≥ 0.09. `ears.py` descarta transcrição com `no_speech_prob` > 0.6 ou curta com `avg_logprob` < -1. Estado `listening` = ativou (palma/wake/atalho) e a janela já abre (`engaged` no App); `hearing` = fala detectada (preroll do wake já nasce em `hearing`). se vier comando junto, entrega o áudio pós-nome como `preroll` pro `Ears`. Conversa contínua: `main.py` abre `ears.start(follow_up=True)` quando o estado vai de speaking→idle num turno de voz. `tts_edge.stream()` decodifica MP3 enquanto baixa (PyAV com `buffer_size=2048`, senão espera a frase toda). Mouth v3 toca por pedaços (`Piece`). Tempo do detector é por frame, não wall-clock (testável offline: `scripts/test_clap.py`), `stt.py` faster-whisper com fallback CUDA→CPU, `mouth.py` dois threads (síntese adiantada + playback) pra não ter buraco entre frases; primeira oração sai na vírgula (`split_sentences(eager=True)`). Playback interrompível. TTS é `tts.py:create_tts()` — Edge (`tts_edge.py`, MP3 decodificado com PyAV) como principal e Kokoro (`tts_kokoro.py`) como fallback automático por 30s a cada falha. Eventos `voice.*` são relayados pelo hub pra todos. Hotkey global vive no Electron (`globalShortcut`), não no Python.
- **Desktop** (`apps/desktop`): Electron frameless transparente. **A janela nunca muda de tamanho**: ocupa a área útil inteira, sempre. Animar bounds no Windows fica travado, então quem anda/encolhe é o orb (`OrbLayer.tsx`, camada fixed, `transform: translate() scale()` com transition — compositor, liso). Modo cheio: orb senta no `.orb-slot` do palco (medido por ResizeObserver), fundo escuro 90%, legendas. Modo minimalista (padrão): pane transparente, orb no canto (ou onde foi arrastado — `localStorage aro.orbPos`) a escala .46, janela **click-through** fora do orb (`setIgnoreMouseEvents(true, {forward:true})`; o renderer mede a distância do cursor ao orb e liga/desliga via IPC `window:setIgnoreMouse`). Auto-expande em `App.tsx` (`engaged`: ouvindo/transcrevendo/lembrete, ou tecla) e auto-recolhe 10s depois de `quiet` — só quando abriu sozinho (`autoExpanded` ref; toggle manual zera). **Sem chat**: `Stage.tsx` (legendas efêmeras: o que ouviu em cima, pensamento e resposta embaixo, somem sozinhas; karaokê via `voice.chunk` com tempo por palavra), `Dock.tsx` (mic sempre; campo de texto só aparece ao digitar, Esc esconde). Header some até passar o mouse. Sem regiões de arraste (`-webkit-app-region`) em lugar nenhum — elas engolem clique e `:hover`; arrastar o orb é pointer events na mão. Órbita de ferramentas, faísca em `tool.done` de memory create/str_replace/insert, sono após 20 min (`lastActivity`), tom por hora do dia e humor (`tinted()` no OrbGL). Bandeja + `Ctrl+Shift+A` + login item no `main/index.ts`; fechar esconde, "Sair" só na bandeja. Renderer fala direto com o hub via `WebSocket` (sem IPC).

## Convenções

- PT-BR em tudo (código, comentários, UI, commits após o prefixo).
- Sem comentário óbvio. Sem overengineering.
- Design: ver tokens em `apps/desktop/src/renderer/src/styles.css`. Pensamento = frio (`--color-thought`), voz do ARO = quente (`--color-voice`). Serif (Instrument Serif) só pra voz do ARO. Motion só no orb (paletas por estado em `OrbCanvas.tsx`). Não reintroduzir lista de mensagens na tela — decisão do Ighor.
- Novas tools: seguir `weather.ts` como modelo. Descrição em PT-BR, input com `.describe()`.
- Rodar `pnpm typecheck` antes de considerar pronto.

## Testar sem API

Desktop pode apontar pra outro hub: `ARO_HUB_URL=ws://localhost:7778 electron .` (ou `?hub=` na URL do renderer). Mock aceita `ARO_PORT`.

Sem Python/voz: `pnpm dev` sobe só core + desktop. `pnpm --filter @aro/core mock` sobe um hub falso com roteiro completo de turno (thinking → tool → texto).

## Não fazer

- Não trocar modelos dos tiers sem o Ighor pedir. Haiku só como classificador — falta compaction/effort/web_search novo nele.
- Tier fast roda com `thinking: disabled` (Sonnet aceita; Opus não — `tierRequestParams` guarda isso). Não usar `budget_tokens`, `temperature` ou prefill — rejeitados no Opus 5.
- Não commitar `apps/core/data/` (memória e sessão são pessoais).
