# Assistente de Tradução — Resumo de Implementação

## Visão geral

Módulo novo inserido no **helper-node** para auxiliar em entrevistas de emprego em idioma estrangeiro.  
O app escuta o entrevistador, transcreve e traduz a pergunta em tempo real, sugere uma resposta profissional, ouve a resposta do candidato e avalia em PT-BR com nota de 1–5 estrelas.

---

## Arquivos criados (novos)

### `services/translationAssistant/vadEngine.js`
Motor de captura de áudio e detecção de fala por energia RMS.  
- Usa **`pw-record`** (PipeWire) para capturar o microfone em PCM s16le 16kHz mono  
- Janelas de 100ms, calcula RMS de cada janela  
- Threshold de silêncio configurável por modo (`interviewer` 1.2s / `user` 3.5s)  
- **`startVAD()`** — captura contínua; entrega WAV para o callback ao detectar fim de fala  
- **`captureOneAnswer()`** — captura exatamente 1 segmento (usado no modo teste); resolve com o caminho do WAV ou `null` se timeout (40s)

### `services/translationAssistant/openaiClient.js`
Todas as chamadas à API OpenAI — sem dependências externas, usa `fetch`/`FormData`/`Blob` globais do Node 18+.  
- **`transcribeAudio(audioPath, apiKey)`** — envia o arquivo de áudio para `gpt-4o-mini-transcribe`; detecção automática de idioma  
- **`getTranslationAndSuggestion(transcript, cfg, apiKey)`** — envia o texto para `gpt-4o-mini`; retorna tradução para o idioma-alvo + sugestão de resposta no idioma original  
- **`evaluateUserResponse(question, userAnswer, cfg, apiKey)`** — avalia a resposta do candidato em PT-BR; retorna feedback construtivo + nota `⭐ X/5`

### `services/translationAssistant/audioUtils.js`
Utilitário de conversão de áudio (criado para o modo ao vivo, atualmente não usado — VAD gera WAV diretamente).  
- **`saveAndAccelerate(float32Array)`** — converte Float32Array PCM → WAV → WebM acelerado 2× via `ffmpeg`  
- Retorna caminho do arquivo temporário (caller deve deletar)

### `services/translationAssistant/index.js`
Orquestrador do modo **ao vivo** (captura contínua durante entrevista real).  
- **`start(cfg)`** — inicia o VAD contínuo; para cada segmento detectado: transcreve → traduz → entrega resultado via `onResult`  
- **`stop()`** — para o VAD e libera o microfone  
- **`isActive()`** — estado atual  
- **`onResult(cb)`** — registra o callback que recebe `{ transcript, response, mode }`

### `services/translationAssistant/testMode.js`
Modo de **simulação de entrevista** com os 5 áudios de `test-audios/`.  
Fluxo por pergunta:  
1. Anuncia a pergunta na UI  
2. Reproduz o áudio (`pw-play` → `paplay` → `ffplay` em cascata) + transcreve em paralelo  
3. Traduz e monta sugestão de resposta  
4. Mostra tudo na tela  
5. Aguarda **8s** para o candidato ler  
6. Abre o microfone e aguarda resposta (até 40s, silêncio de 3.5s para fechar)  
7. Transcreve a resposta do candidato  
8. Avalia em PT-BR com nota  
9. Aguarda **5s** → próxima pergunta  

Arquivos de teste: `pergunta1.ogg`, `pergunta2.ogg`, `pergunta3.ogg`, `pergunta4.ogg`, `pergutna5.ogg` (typo intencional no 5)

---

## Arquivos modificados

### `services/configService.js`
- Adicionado `translationAssistant` ao `defaultConfig`:  
  `{ enabled, userName, userBackground, targetLanguage, testMode }`  
- **`getTranslationAssistantConfig()`** / **`setTranslationAssistantConfig(partial)`**  
- **`getConfig()`** — retorna config completa mesclada  
- **`setConfigValue(dotPath, value)`** — setter genérico com dot-notation

### `config.html`
Nova seção **"🌐 Assistente de Tradução (Entrevistas)"** no final das configurações:  
- Toggle habilitar/desabilitar  
- Campo nome do candidato  
- Textarea de background profissional  
- Select de idioma alvo (PT-BR / EN / ES)  
- Checkbox **"Modo de Teste"** — ao marcar e salvar, dispara o `testMode.js` automaticamente

### `config.js`
- Listeners para todos os campos da seção de tradução  
- IIFE que carrega os valores salvos ao abrir a janela  
- Listener do checkbox de teste → `ipcRenderer.send('set-translation-test-mode', checked)`

### `main.js`
- `require` dos módulos `translationAssistant` e `testMode`  
- `translationAssistant.onResult(...)` registrado na inicialização — entrega via overlay stealth (osIntegration) ou `mainWindow`  
- **IPC handlers adicionados:**
  - `get-translation-assistant-config` / `set-translation-assistant-config`
  - `translation-start` / `translation-stop`
  - `set-translation-test-mode` — salva config, valida API key, executa `runTestMode()` em background, desmarca automaticamente ao concluir

### `preload.js`
- **`onTranslationResult(cb)`** — expõe o evento `translation-result` para o renderer  
- **`translationStart()`** / **`translationStop()`** — invocações IPC para o modo ao vivo

### `index.html`
- Badge fixo **`#ta-indicator`** no canto inferior direito da tela — aparece durante toda a sessão de tradução:
  - 🔊 Bolinha cinza pulsando fraca → reproduzindo pergunta
  - 🎤 Bolinha **vermelha pulsando forte** → mic aberto, aguardando resposta
  - ⏳ Cinza → avaliando
  - Some ao concluir
- Listener `onTranslationResult` que renderiza todos os estados no `#transcription` sem borda azul nem cabeçalhos desnecessários

### `package.json` (dependências instaladas mas não usadas)
- `@ricky0123/vad-web` — abandonado (browser-only, não funciona no main process)
- `node-fetch` v3 — não usado (ESM-only, incompatível com `require`)
- `form-data` — não usado (substituído por `FormData` global nativo)

---

## Decisões técnicas relevantes

| Decisão | Motivo |
|---|---|
| `pw-record` no main process em vez de `@ricky0123/vad-web` | VAD web usa `AudioContext`/`getUserMedia` — APIs de browser, não existem no processo Node do Electron |
| `fetch`/`FormData`/`Blob` globais em vez de `node-fetch` + `form-data` | `node-fetch` v3 é ESM-only; Node 24 + Electron 36 já têm as Web APIs globais |
| Play + transcrição em paralelo (`Promise.all`) | Usuário ouve a pergunta enquanto a API transcreve — sem espera extra |
| Silêncio 3.5s para fechar segmento | 2s cortava o candidato no meio da fala; 3.5s é o mínimo confortável para pausas naturais de raciocínio |
| Badge fixo no canto em vez de inline | Indicador contextual inline poluía a leitura; badge fixo é sempre visível sem interferir no conteúdo |

---

## Pendências conhecidas

- **`audioUtils.js`** — criado mas não está em uso atualmente. Pode ser deletado.
- **Dependências mortas** — `node-fetch`, `form-data`, `@ricky0123/vad-web` podem ser removidas com `npm uninstall`.
- **Botão modo ao vivo** — IPC `translation-start`/`translation-stop` estão prontos no main e no preload, mas falta um botão/atalho no renderer para ativar durante uma entrevista real.

---

## Fluxo completo (modo teste)

```
[Pergunta X/5 anunciada]
       ↓
[Áudio reproduzido + API transcreve em paralelo]
       ↓
[Tradução + sugestão de resposta aparecem na tela]
[Badge: 🎤 Fale agora]  ← 8s para ler
       ↓
[Mic abre — captureOneAnswer() — até 40s, fecha com 3.5s de silêncio]
       ↓
[Transcrição da resposta do candidato]
       ↓
[evaluateUserResponse() → feedback PT-BR + ⭐ X/5]
       ↓
[5s de pausa → próxima pergunta]
       ↓
[✅ Teste concluído — badge some]
```

