// main/helpers/aiResponse.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  // googleTtsService estava sendo USADO aqui (triggerTtsPlaybackIfEnabled) sem
  // constar nesta lista: era um ReferenceError puro, engolido pelo try/catch da
  // própria função. O modo de voz nunca chegou a sintetizar nada — só o card
  // visual, que é renderizado no renderer, dava sinal de vida.
  googleTtsService,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers
} = require('../globals.js');

helpers.buildHelperToolsOpenAIOpts = function(userText, baseInstruction, baseModel, bypassConfirm = false) {
  try {
    if (!helperTools.isEnabled || !helperTools.isEnabled()) {
      return { opts: {} };
    }
    const schema = helperTools.getOpenAIToolsSchema ? helperTools.getOpenAIToolsSchema() : [];
    if (!schema || schema.length === 0) {
      console.warn("🧰 helperTools ON mas schema vazio (nenhuma tool registrada).");
      return { opts: {} };
    }
    const cfg = helperTools.getConfig ? helperTools.getConfig() : {};
    const addon = helperTools.getSystemPromptAddon ? helperTools.getSystemPromptAddon() : "";
    const instruction = [baseInstruction || "", addon].filter(Boolean).join("\n\n");

    // Heurística pra ESCOLHA DE MODELO (não pra ligar/desligar tools):
    //   - se a pergunta tem cara de tarefa pesada (edita arquivo, instala
    //     pacote, comandos) → upgrade pra modelHeavy
    //   - MAS só fazemos upgrade se o modelo do usuário for MAIS BARATO/FRACO
    //     que o modelHeavy. Se ele já escolheu 4.1 ou 5.1, RESPEITA — quem
    //     paga 8x mais por token não quer ser silenciosamente downgrade pra
    //     gpt-4o-mini só porque pediu pra editar um arquivo. Se o user paga
    //     mais, ele quer o modelo mais capaz também nas tools.
    //   - Se o usuário tá no default nano (barato), aí sim upgrade pra heavy.
    // Tools são SEMPRE oferecidas quando o módulo está ON; a IA decide via
    // tool_choice:'auto' se chama ou não.
    //
    // Tier (maior = mais caro/capaz). Reflete pricing OpenAI:
    //   nano family       ~ $0.05-0.10 input  → tier 1
    //   mini family       ~ $0.15-0.25 input  → tier 2 (gpt-4o-mini, gpt-5-mini)
    //   gpt-4.1           ~ $2.00 input       → tier 3
    //   gpt-4o            ~ $2.50 input       → tier 3
    //   gpt-5/5.1/5.2     ~ $1.25-1.75 input  → tier 4 (mais novo, melhor)
    //   gpt-5.4/5.5       ~ $2.50-5.00 input  → tier 5
    const modelTier = (m) => {
      const s = String(m || "").toLowerCase();
      if (!s) return 0;
      // Família 5.6 tem variantes nomeadas (sol/terra/luna) em vez de mini/nano.
      if (/gpt-5\.6-sol/.test(s)) return 5;
      if (/gpt-5\.6-terra/.test(s)) return 4;
      if (/gpt-5\.6-luna/.test(s)) return 2;
      if (/gpt-5\.[45]/.test(s) && !/(mini|nano)/.test(s)) return 5;
      if (/gpt-5(\.\d)?($|[^.\d])/.test(s) && !/(mini|nano)/.test(s)) return 4;
      if (/gpt-4\.1($|[^-])/.test(s) && !/(mini|nano)/.test(s)) return 3;
      if (/gpt-4o($|[^-])/.test(s) && !/mini/.test(s)) return 3;
      if (/mini/.test(s)) return 2;
      if (/nano/.test(s)) return 1;
      return 2; // desconhecido — assume médio
    };
    let model = baseModel;
    // Sinal de intenção pesada por palavra-chave (escrita/edição/comandos).
    const heavyIntent = helperTools.shouldForceHeavyModel
      ? helperTools.shouldForceHeavyModel(userText || "")
      : false;
    // Trabalhando sobre um PROJETO/arquivos anexados, qualquer pergunta (mesmo
    // de leitura, ex.: "qual versão de node?") precisa raciocinar sobre código
    // → o nano default dá respostas rasas/preguiçosas. Nesse contexto forçamos
    // o upgrade também. A regra abaixo (heavyTier > userTier) garante que quem
    // já escolheu um modelo melhor NÃO é rebaixado.
    let hasWorkspaceCtx = false;
    try {
      hasWorkspaceCtx = !!(configService.getWorkspaceAccessEnabled &&
        configService.getWorkspaceAccessEnabled() &&
        workspace.list && workspace.list().length > 0);
    } catch (_) {}
    const forceHeavy = heavyIntent || hasWorkspaceCtx;
    if (forceHeavy) {
      const rawModel = cfg.modelHeavy || "";
      if (rawModel.startsWith("openai:")) {
        const heavyName = rawModel.slice("openai:".length);
        const userTier = modelTier(baseModel);
        const heavyTier = modelTier(heavyName);
        // Só faz upgrade se o modelo do user é mais fraco que o heavy.
        // Senão respeita escolha do user (que já está pagando por algo melhor).
        if (heavyName && heavyTier > userTier) {
          model = heavyName;
        }
      }
    }

    const maxToolCalls = Number.isInteger(cfg.maxToolCallsPerRequest)
      ? cfg.maxToolCallsPerRequest
      : 50;

    const modelTag = forceHeavy
      ? (model === baseModel ? " [HEAVY-kept-user]" : " [HEAVY-upgraded]")
      : "";
    console.log(
      `🧰 helperTools engajado: tools=${schema.length} model=${model}${modelTag} maxToolCalls=${maxToolCalls}`
    );

    return {
      opts: {
        tools: schema,
        maxToolCalls,
        onToolCall: (() => {
          // Anti-duplicação POR PERGUNTA: se a IA pedir writeFile/appendToFile/
          // patchFile com o MESMO (path+content/patch) duas vezes no mesmo turno,
          // a segunda vez retorna ok:true sem rodar. Bug observado: qwen25
          // repete writeFile 3-4x do mesmo README após confirmação.
          const crypto = require('crypto');
          const seen = new Map(); // key → first result
          const hashKey = (name, args) => {
            try {
              const a = args || {};
              if (name === 'writeFile' || name === 'appendToFile') {
                const h = crypto.createHash('sha256')
                  .update(String(a.path || '')).update('\0')
                  .update(String(a.content || ''))
                  .digest('hex').slice(0, 16);
                return `${name}:${h}`;
              }
              if (name === 'patchFile') {
                const h = crypto.createHash('sha256')
                  .update(String(a.path || '')).update('\0')
                  .update(String(a.oldText || '')).update('\0')
                  .update(String(a.newText || '')).update('\0')
                  .update(String(a.startLine || '')).update('\0')
                  .update(String(a.endLine || ''))
                  .digest('hex').slice(0, 16);
                return `${name}:${h}`;
              }
              if (name === 'deleteFile') {
                return `${name}:${String(a.path || '')}`;
              }
            } catch (_) {}
            return null;
          };
          // Resumo legível da ação pra mostrar o "thinking"/ações na UI.
          const shortenPath = (p) => {
            if (!p) return "";
            const normalized = String(p).replace(/\\/g, "/");
            const parts = normalized.split("/").filter(Boolean);
            if (parts.length === 0) return "";
            if (parts.length <= 2) return parts.join("/");
            return parts.slice(-2).join("/");
          };
          const summarizeTool = (name, a = {}) => {
            switch (name) {
              case "readFile": case "readFileChunk": return `Lendo ${shortenPath(a.path)}`;
              case "fileInfo": return `Inspecionando ${shortenPath(a.path)}`;
              case "findFiles": return `Procurando ${a.glob || a.pattern || "arquivos"}`;
              case "listDir": case "readDir": return `Listando ${shortenPath(a.path) || "diretório"}`;
              case "writeFile": return `Escrevendo ${shortenPath(a.path)}`;
              case "appendToFile": return `Anexando em ${shortenPath(a.path)}`;
              case "patchFile": return `Editando ${shortenPath(a.path)}`;
              case "deleteFile": return `Removendo ${shortenPath(a.path)}`;
              case "runCommand": case "runTerminal": return `Rodando: ${String(a.command || a.cmd || "").slice(0, 70)}`;
              case "grep": case "searchInFiles": return `Buscando "${String(a.query || a.pattern || "").slice(0, 50)}"`;
              default: return name;
            }
          };
          const emitActivity = (payload) => {
            try {
              if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                state.mainWindow.webContents.send("ai-tool-activity", payload);
              }
            } catch (_) {}
          };
          return async (name, args /*, meta */) => {
            const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            emitActivity({ id: callId, name, label: summarizeTool(name, args), phase: "start" });
            const key = hashKey(name, args);
            if (key && seen.has(key)) {
              console.log(`🚫 anti-dup: ${name} já executado neste turno (key=${key}); retornando resultado anterior sem reexecutar.`);
              const prev = seen.get(key);
              emitActivity({ id: callId, name, phase: "done", ok: true });
              return {
                ok: true,
                result: {
                  duplicate: true,
                  note: "Esta operação já foi executada neste turno. Prossiga para a próxima ação (ex: commit, push). NÃO repita.",
                  previousResult: prev && prev.result ? prev.result : undefined,
                },
              };
            }
            const res = await helperTools.executeTool(name, args, {
              source: "openai-tool-call",
              force: bypassConfirm,
            });
            if (key && res && res.ok !== false) seen.set(key, res);
            emitActivity({ id: callId, name, phase: "done", ok: res && res.ok !== false });
            return res;
          };
        })(),
      },
      instruction,
      model,
    };
  } catch (e) {
    console.warn("buildHelperToolsOpenAIOpts falhou, seguindo sem tools:", e && e.message);
    return { opts: {} };
  }
}

helpers.prependWorkspaceContextIfNeeded = async function(text, modelKey) {
  try {
    const wsOn = configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled();
    let htOn = helperTools.isEnabled && helperTools.isEnabled();
    const attCount = workspace.list().length;
    if (!wsOn) {
      console.log(`[workspace] SKIP: toggle Acesso a diretorios OFF`);
      return text;
    }

    // A config em disco é a ÚNICA fonte de verdade do toggle. O módulo
    // helperTools guarda uma CÓPIA em memória (_cfg + _initialized), populada
    // só em dois pontos: o boot (main.js) e o IPC set-helper-tools-enabled.
    // Se o boot não rodou o initialize, ou se ele estourou antes de marcar
    // _initialized (audit.init/backup.init/loadBuiltins ficam ANTES da marca),
    // o módulo responde OFF pra sempre enquanto a config diz ON — e o usuário
    // liga as ferramentas, vê o toggle marcado, e o log insiste em "OFF".
    // Aqui a cópia em memória é ressincronizada com a config em vez de
    // silenciosamente ignorar o que o usuário pediu.
    const htConfig = !!(configService.getHelperToolsEnabled && configService.getHelperToolsEnabled());
    if (!htOn && htConfig) {
      console.warn('[helperTools] DESSINCRONIA: config=ON mas modulo=OFF — ressincronizando');
      try {
        helperTools.updateConfig(configService.getHelperToolsConfig());
        htOn = helperTools.isEnabled();
        console.log(`[helperTools] apos ressincronizar: isEnabled=${htOn}`);
      } catch (e) {
        console.error('[helperTools] falha ao ressincronizar:', e && e.message);
      }
    }

    if (!htOn) {
      console.log(`[workspace] SKIP: Ferramentas avancadas OFF (config=${htConfig}, modulo=${htOn})`);
      return text;
    }
    if (attCount === 0) {
      console.log(`[workspace] SKIP: nenhum anexo no painel`);
      return text;
    }
    // Âncora CURTA do projeto ativo — vai em TODO turno (barato). Sem isso o
    // modelo esquece a raiz do projeto após a 1ª msg e começa a varrer ~ ("achei
    // 3 projetos, qual o caminho?"). O blueprint completo (árvore) vai só 1x.
    const dirs = workspace.list().filter((a) => a.type === "dir");
    let anchor = "";
    if (dirs.length) {
      const root = dirs[0].path;
      anchor =
        `[PROJETO ATIVO: ${root}]\n` +
        `Esta é a RAIZ do projeto em que estamos trabalhando. Faça TODAS as operações ` +
        `de arquivo/busca/comando DENTRO deste diretório (use-o como cwd). ` +
        `NÃO procure em ~ nem em outros projetos. Caminho relativo = relativo a esta raiz.`;
    }

    const ctx = await workspace.buildContextIfNeeded(modelKey || "", { userText: text });
    if (!ctx) {
      console.log(`[workspace] contexto ja injetado; mandando só a âncora do projeto (anexos=${attCount}).`);
      return anchor ? anchor + "\n\n---\n\n" + (text || "") : text;
    }
    workspace.markContextSent();
    console.log(`[workspace] ✅ contexto injetado (${ctx.length} chars, ${attCount} anexos, model=${modelKey})`);
    return (anchor ? anchor + "\n\n" : "") + ctx + "\n\n---\n\n" + (text || "");
  } catch (e) {
    console.warn("[workspace] prependContext falhou:", e.message);
    return text;
  }
}

helpers.formatForPlainTextNotification = function(html) {
  let text = html;
  // Substitui tags de bloco por quebras de linha para melhor legibilidade
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");

  // Converte tags de ênfase para uma sintaxe similar a markdown
  text = text.replace(/<strong>(.*?)<\/strong>/gi, "**");
  text = text.replace(/<b>(.*?)<\/b>/gi, "**");
  text = text.replace(/<em>(.*?)<\/em>/gi, "__");
  text = text.replace(/<i>(.*?)<\/i>/gi, "__");

  // Remove quaisquer tags HTML restantes
  text = text.replace(/<[^>]*>/g, "");

  // Decodifica entidades HTML comuns
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  return text.trim();
}

helpers.chunkText = function(text, chunkSize = 250) {
  const finalChunks = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.length <= chunkSize) {
      finalChunks.push(line.trim());
    } else {
      // This line is too long, so we chunk it.
      let remaining = line;
      while (remaining.length > 0) {
        let chunk = remaining.substring(0, chunkSize);
        const lastSpace = chunk.lastIndexOf(" ");

        if (lastSpace > 0 && remaining.length > chunkSize) {
          chunk = chunk.substring(0, lastSpace);
        }

        finalChunks.push(chunk.trim());
        remaining = remaining.substring(chunk.length).trim();
      }
    }
  }
  return finalChunks;
}

helpers.formatToHTML = function(text) {
  if (!text) return "";

  const escapeHTML = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  let formatted = text;
  formatted = formatted.replace(/<voice_summary>([\s\S]*?)<\/voice_summary>/gi, (match, summary) => {
    const clean = summary.replace(/<[^>]*>/g, '').trim();
    return `<div class="voice-summary-card"><span class="voice-icon">🔊</span><div class="voice-content"><strong>Resumo em Áudio:</strong> ${clean}</div></div>`;
  });

  const codeBlocks = [];

  // Capturar blocos de código
  formatted = formatted.replace(
    /```(\w+)?\n([\s\S]*?)\n```/g,
    (match, lang, code) => {
      const codeId = `code-block-${codeBlocks.length}`;
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(
        `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${
          lang || "text"
        }">${escapeHTML(code)}</code></pre>`
      );
      return placeholder;
    }
  );

  const lines = formatted.split("\n");
  const formattedLines = [];

  for (let line of lines) {
    if (line.match(/__CODE_BLOCK_\d+__/)) {
      formattedLines.push(line);
      continue;
    }

    line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, "<strong>$1$2</strong>");
    line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, "<em>$1$2</em>");
    if (line.match(/^\s*[-*]\s+(.+)/)) {
      line = line.replace(/^\s*[-*]\s+(.+)/, "<li>$1</li>");
    } else if (line.trim()) {
      line = `<p>${line}</p>`;
    }

    formattedLines.push(line);
  }

  // Não usar <br> entre <p>/<li> — eles já têm margem própria.
  // <br> só faz sentido entre linhas "soltas" (placeholders de bloco de código).
  formatted = formattedLines
    .filter((line) => line.trim())
    .map((line) => {
      // Linha já é tag de bloco? mantém sem <br> extra.
      if (/^\s*(<p>|<li>|__CODE_BLOCK_)/.test(line)) return line;
      return line + "<br>";
    })
    .join("");

  if (formatted.includes("<li>")) {
    // Agrupa <li> consecutivos em <ul>
    formatted = formatted.replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  }

  codeBlocks.forEach((block, index) => {
    formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
  });

  formatted = formatted.replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
  return formatted;
}

helpers.buildPromptWithHistory = function(currentText, pastMessages = [], opts = {}) {
  try {
    const { buildPromptWithHistory } = require('../../services/historyFormatter');
    return buildPromptWithHistory(currentText, pastMessages, opts);
  } catch (e) {
    console.warn('[helpers.buildPromptWithHistory] fallback to currentText:', e.message);
    return currentText;
  }
};

helpers.appendVoiceSummaryInstructionIfNeeded = function(instructionOrPrompt) {
  try {
    const cfg = configService.getGoogleTtsConfig();
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);
    const isTtsOn = !!(cfg && cfg.enabled && cfg.keyPathOrKey && cfg.keyPathOrKey.trim());

    if (!isNexaOn || !isTtsOn) return instructionOrPrompt;

    const voiceSpeakerNote = " O resumo DEVE ser escrito em PRIMEIRA PESSOA PELA NEXA (ex: 'Pronto! Analisei e fiz os ajustes...'). NUNCA narre em terceira pessoa nem mencione assistentes genéricos ou nomes de terceiros.";
    const directive = `\n\n[INSTRUÇÃO DE MODO DE VOZ ATIVO]\nSua resposta DEVE incluir ao final a tag <voice_summary>resumo sucinto em 1 a 2 frases para ser lido em voz alta (no mesmo idioma da sua resposta).${voiceSpeakerNote} NUNCA inclua códigos, tabelas ou exemplos longos dentro da tag voice_summary. Se houver códigos ou exemplos na resposta, peça para o usuário olhá-los na tela.</voice_summary>`;
    return (instructionOrPrompt || "") + directive;
  } catch (e) {
    return instructionOrPrompt;
  }
};

helpers.triggerTtsPlaybackIfEnabled = function(fullResponse) {
  try {
    const cfg = configService.getGoogleTtsConfig();
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);
    const isTtsOn = !!(cfg && cfg.enabled);

    if (!isNexaOn || !isTtsOn) return;
    if (!cfg || !cfg.keyPathOrKey || !cfg.keyPathOrKey.trim()) return;

    let cleanResponse = fullResponse;
    if (isNexaOn && fullResponse) {
      try {
        const { parseNexaResponse } = require("../nexa/nexaResponseHelper.js");
        const parsed = parseNexaResponse(fullResponse);
        cleanResponse = parsed.response;
      } catch (err) {
        console.warn("[aiResponse] Falha ao extrair resposta para TTS:", err.message);
      }
    }

    const summary = googleTtsService.extractVoiceSummary(cleanResponse);
    if (!summary || !summary.trim()) return;

    const voiceToUse = cfg.voiceName || 'pt-BR-Neural2-C';
    const speakingRate = cfg.speakingRate !== undefined ? cfg.speakingRate : 1.0;
    const pitch = cfg.pitch !== undefined ? cfg.pitch : 0.0;

    console.log(`🔊 Sintetizando resumo por voz Google TTS (Nexa=${isNexaOn}, pitch=${pitch}, rate=${speakingRate}):`, summary);
    googleTtsService.synthesizeText(summary, {
      keyOrPath: cfg.keyPathOrKey,
      voiceName: voiceToUse,
      speakingRate,
      pitch
    }).then(buf => {
      const audioPayload = {
        audioBase64: buf.toString("base64"),
        text: summary
      };
      // Emite o evento global do IPCMain para acionar nexaIntegration e a janela do renderer
      const { ipcMain } = require("electron");
      ipcMain.emit("play-tts-audio", null, audioPayload);

      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send("play-tts-audio", audioPayload);
      }
    }).catch(err => {
      console.error("🔊 Erro no Google TTS playback:", err && err.message);
    });
  } catch (e) {
    console.error("🔊 Erro ao acionar TTS:", e && e.message);
  }
};

