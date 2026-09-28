# Diretiva Global: Modelos Ativos e Proibicao de Modelos Obsoletos

Este documento define os modelos oficiais suportados no Helper Node e proibe estritamente a reintroducao de modelos obsoletos ou descontinuados.

## 1. Modelos Terminantemente Proibidos

NUNCA utilize, sugira, configure ou adicione ao codigo os seguintes modelos ou padroes:
- gemini-2.0* (ex.: gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.0-flash-exp, gemini-2.0-flash-realtime-exp)
- gemini-2.5* (ex.: gemini-2.5-flash, gemini-2.5-pro)
- gemini-1.5* (ex.: gemini-1.5-flash, gemini-1.5-pro)
- 3.1-flash-live-preview (rejeitado pela API Live com erro 1008)

## 2. Catalogo Oficial de Modelos Ativos

### Antigravity CLI (geminiCli)
Para execucao via CLI e chat principal:
- gemini-3.7-flash-high (Padrao / Default)
- gemini-3.8-flash-high
- gemini-3.6-flash-high
- gemini-3.1-pro-high
- claude-sonnet-4-6

Nota: Slugs passados para a CLI agy devem ser estritamente em letras minusculas com hifens (ex.: `gemini-3.7-flash-high`), tratados por `normalizeModelId()`.

### Transcricao de Audio (STT / Ditado Ctrl+D)
Para transcricao de audio rapida multimodal (Google Generative Language API):
- gemini-3.5-transcribe (Primario de altissima velocidade, ~500ms)
- gemini-3.8-flash (Fallback)
- gemini-3.7-flash (Fallback)
- gemini-3.6-flash (Fallback)
- gemini-3.5-flash (Fallback)
- gemini-flash-latest (Fallback)

### Nexa Voice / Gemini Live (WebSocket Bidi)
Para interacao de voz em tempo real (bidiGenerateContent):
- models/gemini-3.8-flash (Primario ativo)
- models/gemini-3.7-flash (Secundario ativo)

## 3. Diretriz para o Agente
Antes de modificar qualquer integracao de IA, consulte sempre a lista acima. NUNCA regrida para modelos legados.
