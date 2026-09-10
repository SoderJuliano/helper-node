/**
 * renderer/nexa/nexaRenderer.js
 * Loop principal de renderização HTML5 2D Canvas via requestAnimationFrame,
 * escuta de IPCs Electron e integração de áudio Google TTS.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const canvas = document.getElementById("nexaCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let lastTime = performance.now();

  // Tamanho fixo do Canvas (360x360) da janela flutuante da Nexa
  function resizeCanvas() {
    canvas.width = 360;
    canvas.height = 360;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Busca a configuração da Nexa e o trim da animação
  let introTrimEndMs = 100;
  try {
    if (window.electronAPI && window.electronAPI.getNexaConfig) {
      const nexaCfg = await window.electronAPI.getNexaConfig();
      if (nexaCfg && nexaCfg.introTrimEndMs !== undefined) {
        introTrimEndMs = nexaCfg.introTrimEndMs;
      }
    }
  } catch (err) {
    console.warn("[NexaRenderer] Erro ao buscar configuração da Nexa:", err);
  }

  // Inicializa o personagem e controladores procedurais
  const character = new NexaCharacter();
  const animController = new NexaAnimationController(character);

  // Caminho absoluto das camadas PNG geradas (PSD ainda não baixado nesta máquina).
  // Comentado de propósito: o personagem procedural baseado em PSD fica em espera
  // aqui pra ser reativado depois, quando as camadas chegarem. Enquanto isso, o
  // baseIdleAnimation (Lottie) assume o repouso e o speakingAnimation assume a fala.
  // const assetsPath = "/home/soder/Documents/nexa-workspace/see-through/workspace/layerdiff_output/Nexa_front_cutout";
  // const loaded = await character.loadAssets(assetsPath);
  // if (!loaded) {
  //   console.error("[NexaRenderer] Erro crítico ao carregar camadas PNG.");
  // }

  // Helper para instanciar animações Lottie
  const createLottieAnim = (dir, loop = false) =>
    typeof NexaLottieAnimation !== "undefined"
      ? new NexaLottieAnimation({ animationPath: `renderer/nexa/assets/lottie/${dir}/animations/main.json`, loop })
      : null;

  const introAnimation = createLottieAnim("wave_lottie");
  if (introAnimation) introAnimation.play();

  const idleBoringAnimation = createLottieAnim("idle_lottie");
  const idleGlassesAnimation = createLottieAnim("adjust_glasses_lottie");
  const idleStretchingAnimation = createLottieAnim("stretching_lottie");
  const idleSquattingAnimation = createLottieAnim("squatting_lottie");
  const idleSleepingAnimation = createLottieAnim("sleeping_lottie", true);
  const baseIdleAnimation = createLottieAnim("base_idle_lottie", true);
  const speakingAnimation = createLottieAnim("speaking_lottie", true);
  const writingAnimation = createLottieAnim("typing_lottie", true);
  const thinkingAnimation = createLottieAnim("thinking_lottie", true);
  const listeningAnimation = createLottieAnim("listening_lottie", false);

  let currentVideoAnimation = introAnimation;
  let idleTime = 0;
  let sleepingTime = 0;
  const SLEEP_TIMEOUT = 10 * 60; // 10 minutos (600s)
  let isSleeping = false;
  let pendingStateTransition = null;
  let pendingTransitionTimeout = null;

  function isIdleMovementAnimation(anim) {
    if (!anim || !anim.isPlaying || anim.isFinished()) return false;
    return (
      anim === idleBoringAnimation ||
      anim === idleGlassesAnimation ||
      anim === idleStretchingAnimation ||
      anim === idleSquattingAnimation ||
      anim === idleSleepingAnimation ||
      (anim.animationPath && (
        anim.animationPath.includes("idle_lottie") ||
        anim.animationPath.includes("adjust_glasses") ||
        anim.animationPath.includes("stretching") ||
        anim.animationPath.includes("squatting") ||
        anim.animationPath.includes("sleeping")
      ))
    );
  }

  function applyStateAnimation(stateToApply) {
    if (pendingTransitionTimeout) {
      clearTimeout(pendingTransitionTimeout);
      pendingTransitionTimeout = null;
    }
    pendingStateTransition = null;
    animController.setState(stateToApply);

    if (stateToApply === "LISTENING") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== listeningAnimation) {
        currentVideoAnimation.stop();
      }
      if (listeningAnimation) {
        console.log("[NexaRenderer] Transicionando para LISTENING. Iniciando animação de escuta.");
        listeningAnimation.play();
        currentVideoAnimation = listeningAnimation;
      }
    } else if (stateToApply === "THINKING") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== thinkingAnimation) {
        currentVideoAnimation.stop();
      }
      if (thinkingAnimation) {
        console.log("[NexaRenderer] Transicionando para THINKING. Iniciando animação de pensamento.");
        thinkingAnimation.play();
        currentVideoAnimation = thinkingAnimation;
      }
    } else if (stateToApply === "SPEAKING") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== speakingAnimation) {
        currentVideoAnimation.stop();
      }
      if (speakingAnimation) {
        console.log("[NexaRenderer] Transicionando para SPEAKING. Iniciando animação de fala em loop.");
        speakingAnimation.play();
        currentVideoAnimation = speakingAnimation;
      }
    } else if (stateToApply === "WORKING") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== writingAnimation) {
        currentVideoAnimation.stop();
      }
      if (writingAnimation) {
        console.log("[NexaRenderer] Transicionando para WORKING. Iniciando animação de escrita/leitura de arquivos.");
        writingAnimation.play();
        currentVideoAnimation = writingAnimation;
      }
    } else {
      // Estado IDLE ou outros
      if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
        const pathStr = currentVideoAnimation.videoPath || currentVideoAnimation.animationPath || "";
        if (pathStr.includes("thinking") || pathStr.includes("listening") || pathStr.includes("speaking") || pathStr.includes("writing") || pathStr.includes("typing")) {
          console.log("[NexaRenderer] Parando animação ativa por retorno a IDLE.");
          currentVideoAnimation.stop();
          currentVideoAnimation = null;
        }
      }
    }
  }

  // Busca o catálogo de animações do Main
  let animationsCatalog = {};
  if (window.electronAPI && window.electronAPI.getAnimations) {
    window.electronAPI.getAnimations().then((catalog) => {
      animationsCatalog = catalog || {};
      console.log("[NexaRenderer] Catálogo de animações carregado:", Object.keys(animationsCatalog));
    }).catch(err => {
      console.warn("[NexaRenderer] Erro ao carregar catálogo de animações:", err);
    });
  }

  // Ouvinte para reprodução de animações enviadas pela IA
  if (window.electronAPI && window.electronAPI.onPlayAnimation) {
    window.electronAPI.onPlayAnimation(({ name }) => {
      console.log("[NexaRenderer] Evento de animação recebido:", name);
      const animDef = animationsCatalog[name];
      if (!animDef) {
        console.warn("[NexaRenderer] Animação ausente no catálogo local:", name);
        return;
      }

      if (animDef.lottiePath) {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          currentVideoAnimation.stop();
        }
        console.log("[NexaRenderer] Iniciando animação Lottie:", name);
        currentVideoAnimation = new NexaLottieAnimation({ animationPath: animDef.lottiePath, loop: false });
        currentVideoAnimation.play();
      } else if (animDef.videoPath) {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          currentVideoAnimation.stop();
        }
        console.log("[NexaRenderer] Iniciando animação de vídeo:", name);
        currentVideoAnimation = new NexaIntroAnimation({ videoPath: animDef.videoPath, introTrimEndMs });
        currentVideoAnimation.play();
      } else if (animDef.procedural) {
        console.log("[NexaRenderer] Iniciando animação procedural:", name);
        animController.playProceduralReaction(name);
      }
    });
  }

  // 1. Escuta de IPC: Mudança de Estado (IDLE, LISTENING, THINKING, SPEAKING, WORKING)
  if (window.electronAPI && window.electronAPI.onNexaStateChange) {
    window.electronAPI.onNexaStateChange(({ state: newState }) => {
      console.log("[NexaRenderer] Novo estado recebido via IPC:", newState);

      // Transição suave: se uma animação de movimento IDLE estiver em curso (espreguiçar, óculos, agachar, idle)
      // e o novo estado for THINKING ou WORKING (lendo/escrevendo arquivos), primeiro finaliza o ciclo atual
      // antes de entrar na nova animação, evitando cortes bruscos no meio do movimento!
      if (isIdleMovementAnimation(currentVideoAnimation) && (newState === "THINKING" || newState === "WORKING")) {
        console.log(`[NexaRenderer] Animação de movimento em curso (${currentVideoAnimation.animationPath}) -> aguardando fim do loop para transicionar suavemente para ${newState}...`);
        
        pendingStateTransition = newState;
        animController.setState(newState); // Sincroniza estado lógico interno

        if (pendingTransitionTimeout) clearTimeout(pendingTransitionTimeout);

        currentVideoAnimation.finishLoopAndStop(() => {
          if (pendingStateTransition === newState) {
            console.log(`[NexaRenderer] Loop da animação idle concluído com sucesso -> iniciando ${newState}.`);
            applyStateAnimation(newState);
          }
        });

        // Timeout de segurança (máximo 3.5s) para garantir a transição sem travar a UI
        pendingTransitionTimeout = setTimeout(() => {
          if (pendingStateTransition === newState) {
            console.log(`[NexaRenderer] Timeout de transição suave atingido -> iniciando ${newState}.`);
            applyStateAnimation(newState);
          }
        }, 3500);
        return;
      }

      applyStateAnimation(newState);
    });
  }

  // 2. Escuta de IPC: Reprodução de Áudio Google TTS
  let currentAudio = null;

  if (window.electronAPI && window.electronAPI.onPlayTtsAudio) {
    window.electronAPI.onPlayTtsAudio(({ audioBase64 }) => {
      console.log("[NexaRenderer] Recebido áudio TTS -> iniciando reprodução e sincronização...");
      
      playTtsAudio(audioBase64);
    });
  }

  function stopTtsAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (_) {}
      currentAudio = null;
    }
    stopSpeakingAnimation();
    animController.setState("IDLE");
  }

  if (window.electronAPI && window.electronAPI.onStopTtsAudio) {
    window.electronAPI.onStopTtsAudio(() => {
      console.log("[NexaRenderer] Barge-in acionado -> parando áudio TTS e animação de fala imediatamente.");
      stopTtsAudio();
    });
  }

  let lastAudioBase64 = null;
  let lastAudioPlayTime = 0;

  function playTtsAudio(base64Data) {
    if (!base64Data) return;
    const now = Date.now();
    // Previne repetição acidental do áudio no início por eventos de IPC duplicados
    if (lastAudioBase64 === base64Data && (now - lastAudioPlayTime < 1000)) {
      console.log("[NexaRenderer] Áudio TTS duplicado ignorado (debounce).");
      return;
    }
    lastAudioBase64 = base64Data;
    lastAudioPlayTime = now;

    stopTtsAudio();

    try {
      const audioUrl = `data:audio/mp3;base64,${base64Data}`;
      currentAudio = new Audio(audioUrl);
      currentAudio.volume = 1.0;

      // Dispara a animação visual de fala em loop
      if (speakingAnimation) {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== speakingAnimation) {
          currentVideoAnimation.stop();
        }
        speakingAnimation.play();
        currentVideoAnimation = speakingAnimation;
      }
      animController.setState("SPEAKING");

      currentAudio.onplay = () => {
        animController.setState("SPEAKING");
      };

      currentAudio.onended = () => {
        console.log("[NexaRenderer] Áudio TTS concluído com sucesso.");
        currentAudio = null;
        stopSpeakingAnimation();
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      };

      currentAudio.onerror = (err) => {
        console.error("[NexaRenderer] Erro no áudio TTS:", err);
        currentAudio = null;
        stopSpeakingAnimation();
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      };

      const playPromise = currentAudio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log("[NexaRenderer] Reproduzindo áudio TTS no fone/saída de som ativa.");
        }).catch((err) => {
          console.error("[NexaRenderer] Falha na reprodução de áudio:", err);
          stopSpeakingAnimation();
          animController.setState("IDLE");
          if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
            window.electronAPI.sendNexaTtsEnded();
          }
        });
      }
    } catch (e) {
      console.error("[NexaRenderer] Exceção ao tocar TTS:", e);
      stopSpeakingAnimation();
      animController.setState("IDLE");
      if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
        window.electronAPI.sendNexaTtsEnded();
      }
    }
  }

  // Para a animação de fala em loop de forma imediata (sem esperar o round-trip de IPC do estado)
  function stopSpeakingAnimation() {
    if (speakingAnimation && speakingAnimation.isPlaying) {
      speakingAnimation.stop();
      if (currentVideoAnimation === speakingAnimation) {
        currentVideoAnimation = null;
      }
    }
  }

  // 3. Loop Principal de Renderização 60FPS (requestAnimationFrame)
  function renderLoop(currentTime) {
    const deltaTime = Math.min(0.1, (currentTime - lastTime) / 1000.0);
    lastTime = currentTime;

    // Se o estado mudar de IDLE, gerencia acordar da soneca se estiver dormindo
    if (currentState !== "IDLE") {
      if (isSleeping) {
        console.log("[NexaRenderer] Nexa acordou devido a atividade/novo estado:", currentState);
        isSleeping = false;
        if (currentVideoAnimation === idleSleepingAnimation && !pendingStateTransition) {
          idleSleepingAnimation.stop();
          currentVideoAnimation = null;
        }
      }
      idleTime = 0;
      sleepingTime = 0;
    }

    let rendered = false;

    if (currentVideoAnimation && !currentVideoAnimation.isFinished() && currentVideoAnimation.isPlaying) {
      currentVideoAnimation.update(deltaTime);
      currentVideoAnimation.render(ctx, canvas.width, canvas.height);
      if (!currentVideoAnimation.isFinished()) {
        rendered = true;
      }
    }

    // Se a animação em curso terminou seu loop e havia uma transição pendente (ex: THINKING/WORKING)
    if (!rendered && pendingStateTransition) {
      const targetState = pendingStateTransition;
      pendingStateTransition = null;
      applyStateAnimation(targetState);
      if (currentVideoAnimation && !currentVideoAnimation.isFinished() && currentVideoAnimation.isPlaying) {
        currentVideoAnimation.update(deltaTime);
        currentVideoAnimation.render(ctx, canvas.width, canvas.height);
        if (!currentVideoAnimation.isFinished()) {
          rendered = true;
        }
      }
    }

    if (!rendered) {
      animController.update(deltaTime);

      // O idle base entra aqui, no lugar do animController.render (personagem PSD).
      // O play() é preguiçoso de propósito: init() faz innerHTML="" no
      // #lottieContainer compartilhado, e chamá-lo cedo derrubaria o canvas da
      // intro. Nunca vira currentVideoAnimation, senão `rendered` ficaria true e
      // o sorteio das idles aleatórias abaixo nunca rodaria.
      if (baseIdleAnimation) {
        if (!baseIdleAnimation.isPlaying) baseIdleAnimation.play();
        baseIdleAnimation.render(ctx, canvas.width, canvas.height);
      } else {
        animController.render(ctx, canvas.width, canvas.height);
      }

      // Controle do tempo de inatividade para dormir (10 minutos)
      if (currentState === "IDLE") {
        if (!isSleeping) {
          sleepingTime += deltaTime;
          if (sleepingTime >= SLEEP_TIMEOUT) {
            console.log("[NexaRenderer] Nexa adormeceu devido a inatividade de 10 minutos.");
            isSleeping = true;
            if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
              currentVideoAnimation.stop();
            }
            if (idleSleepingAnimation) {
              idleSleepingAnimation.play();
              currentVideoAnimation = idleSleepingAnimation;
            }
          }
        }
      }

      // Sorteio aleatório para as animações idle normais (somente se não estiver dormindo)
      if (currentState === "IDLE" && !isSleeping && (!introAnimation || introAnimation.isFinished())) {
        idleTime += deltaTime;
        if (idleTime >= 4.0) {
          idleTime = 0;
          if (Math.random() < 0.25) {
            const r = Math.random();
            if (r < 0.30 && idleGlassesAnimation) {
              console.log("[NexaRenderer] Sorteando animação de ajustar óculos...");
              idleGlassesAnimation.play();
              currentVideoAnimation = idleGlassesAnimation;
            } else if (r < 0.60 && idleBoringAnimation) {
              console.log("[NexaRenderer] Sorteando animação idle/boring...");
              idleBoringAnimation.play();
              currentVideoAnimation = idleBoringAnimation;
            } else if (r < 0.90 && idleStretchingAnimation) {
              console.log("[NexaRenderer] Sorteando animação de se espreguiçar...");
              idleStretchingAnimation.play();
              currentVideoAnimation = idleStretchingAnimation;
            } else if (idleSquattingAnimation) {
              console.log("[NexaRenderer] Sorteando animação de agachar...");
              idleSquattingAnimation.play();
              currentVideoAnimation = idleSquattingAnimation;
            }
          }
        }
      }
    }

    requestAnimationFrame(renderLoop);
  }

  // 4. Inicializa o gerenciador de arraste de janela com proteção contra interrupção de trabalho/pensamento
  if (typeof NexaDragHandler !== "undefined") {
    new NexaDragHandler({
      canvas,
      animController,
      getCurrentAnimation: () => currentVideoAnimation,
      setCurrentAnimation: (anim) => { currentVideoAnimation = anim; },
      getIsSleeping: () => isSleeping
    });
  }

  // 5. Inicializa suporte a captura de webcam (Olhos da Nexa)
  if (typeof initNexaWebcam === "function") {
    initNexaWebcam();
  }

  // Obtém o estado inicial do Main
  if (window.electronAPI && window.electronAPI.getNexaState) {
    window.electronAPI.getNexaState().then((state) => {
      if (state) animController.setState(state);
    }).catch(() => {});
  }

  requestAnimationFrame(renderLoop);
});
