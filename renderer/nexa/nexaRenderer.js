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

  // Redimensionamento responsivo do Canvas de acordo com a janela
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Permite redimensionar a janela flutuante da Nexa usando a roda do mouse (Ctrl/Shift + Scroll ou Scroll na janela)
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 30 : -30;
      const newSize = Math.max(180, Math.min(800, window.innerWidth + delta));
      if (window.electronAPI && window.electronAPI.resizeNexaWindow) {
        window.electronAPI.resizeNexaWindow(newSize, newSize);
      }
    }
  }, { passive: false });

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

  let currentVideoAnimation = introAnimation;
  let idleTime = 0;
  let sleepingTime = 0;
  const SLEEP_TIMEOUT = 10 * 60; // 10 minutos (600s)
  let isSleeping = false;

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

  // 1. Escuta de IPC: Mudança de Estado (IDLE, LISTENING, THINKING, SPEAKING)
  if (window.electronAPI && window.electronAPI.onNexaStateChange) {
    window.electronAPI.onNexaStateChange(({ state: newState }) => {
      console.log("[NexaRenderer] Novo estado recebido via IPC:", newState);
      animController.setState(newState);
      
      if (newState === "LISTENING") {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          currentVideoAnimation.stop();
        }
        const listeningLottiePath = "renderer/nexa/assets/lottie/listening_lottie/animations/main.json";
        console.log("[NexaRenderer] Transicionando para LISTENING. Iniciando animação de escuta.");
        currentVideoAnimation = new NexaLottieAnimation({
          animationPath: listeningLottiePath,
          loop: false
        });
        currentVideoAnimation.play();
      } else if (newState === "THINKING") {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          currentVideoAnimation.stop();
        }
        const thinkingLottiePath = "renderer/nexa/assets/lottie/thinking_lottie/animations/main.json";
        console.log("[NexaRenderer] Transicionando para THINKING. Iniciando animação de pensamento.");
        currentVideoAnimation = new NexaLottieAnimation({
          animationPath: thinkingLottiePath,
          loop: true // loop while waiting for AI
        });
        currentVideoAnimation.play();
      } else if (newState === "SPEAKING") {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== speakingAnimation) {
          currentVideoAnimation.stop();
        }
        if (speakingAnimation) {
          console.log("[NexaRenderer] Transicionando para SPEAKING. Iniciando animação de fala em loop.");
          speakingAnimation.play();
          currentVideoAnimation = speakingAnimation;
        }
      } else if (newState === "WORKING") {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying && currentVideoAnimation !== writingAnimation) {
          currentVideoAnimation.stop();
        }
        if (writingAnimation) {
          console.log("[NexaRenderer] Transicionando para WORKING. Iniciando animação de escrita de arquivos.");
          writingAnimation.play();
          currentVideoAnimation = writingAnimation;
        }
      } else {
        // Se mudou para qualquer outro estado (como IDLE), para animações de escuta, pensamento, fala ou escrita
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          const pathStr = currentVideoAnimation.videoPath || currentVideoAnimation.animationPath || "";
          if (pathStr.includes("thinking") || pathStr.includes("listening") || pathStr.includes("speaking") || pathStr.includes("writing") || pathStr.includes("typing")) {
            console.log("[NexaRenderer] Parando animação ativa por transição de estado.");
            currentVideoAnimation.stop();
          }
        }
      }
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

  function playTtsAudio(base64Data) {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio = null;
      } catch (_) {}
    }

    try {
      const audioUrl = `data:audio/mp3;base64,${base64Data}`;
      currentAudio = new Audio(audioUrl);

      // Conecta o áudio ao analisador da fala antes de iniciar
      animController.connectAudioElement(currentAudio);

      currentAudio.onplay = () => {
        animController.setState("SPEAKING");
      };

      currentAudio.onended = () => {
        console.log("[NexaRenderer] Áudio TTS concluído.");
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

      currentAudio.play().catch((err) => {
        console.error("[NexaRenderer] Falha na reprodução:", err);
        stopSpeakingAnimation();
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      });
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

    const currentState = animController.getCurrentState();

    // Se o estado mudar de IDLE, interrompe as animações idle/sleeping imediatamente e acorda a Nexa
    if (currentState !== "IDLE") {
      if (isSleeping) {
        console.log("[NexaRenderer] Nexa acordou devido a atividade/novo estado:", currentState);
        isSleeping = false;
        if (currentVideoAnimation === idleSleepingAnimation) {
          idleSleepingAnimation.stop();
          currentVideoAnimation = null;
        }
      }
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && !currentVideoAnimation.isFinished()) {
        if (currentVideoAnimation === idleBoringAnimation || 
            currentVideoAnimation === idleGlassesAnimation ||
            currentVideoAnimation === idleStretchingAnimation ||
            currentVideoAnimation === idleSquattingAnimation ||
            currentVideoAnimation === idleSleepingAnimation) {
          currentVideoAnimation.stop();
          console.log("[NexaRenderer] Animação idle interrompida por mudança de estado para:", currentState);
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

  // Lógica de drag-and-drop da Nexa
  let isDraggingWindow = false;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) { // Botão esquerdo do mouse
      isDraggingWindow = true;
      canvas.style.cursor = "grabbing";

      // Inicia o arraste da janela Electron
      if (window.electronAPI && window.electronAPI.startWindowDrag) {
        window.electronAPI.startWindowDrag();
      }

      // Se ela estiver dormindo, NÃO interrompe o sono nem inicia a animação de flutuação!
      if (isSleeping) {
        console.log("[NexaRenderer] Janela arrastada enquanto dorme. Mantendo o sono.");
        return;
      }

      // Interrompe a animação de vídeo atual
      if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
        currentVideoAnimation.stop();
      }

      // Inicia a animação de flutuar (floating) em loop via Lottie
      const floatingLottiePath = "renderer/nexa/assets/lottie/floating_lottie/animations/main.json";
      console.log("[NexaRenderer] Arrastando janela. Iniciando animação de flutuação.");
      currentVideoAnimation = new NexaLottieAnimation({
        animationPath: floatingLottiePath,
        loop: true
      });
      currentVideoAnimation.play();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (isDraggingWindow) {
      isDraggingWindow = false;
      canvas.style.cursor = "grab";

      // Finaliza o arraste da janela Electron
      if (window.electronAPI && window.electronAPI.endWindowDrag) {
        window.electronAPI.endWindowDrag();
      }

      // Se ela estiver dormindo, NÃO inicia animação de pouso!
      if (isSleeping) {
        console.log("[NexaRenderer] Janela solta enquanto dorme. Mantendo o sono.");
        return;
      }

      // Prepara a animação de queda/aterrissagem (landing) sem loop, a 1.5x de velocidade via Lottie,
      // cortando os primeiros 150ms (piscada estática) e os últimos 350ms (quadrado branco do final)
      const landingLottiePath = "renderer/nexa/assets/lottie/landing_lottie/animations/main.json";
      console.log("[NexaRenderer] Soltou janela. Iniciando carregamento do pouso...");
      
      const landingAnim = new NexaLottieAnimation({
        animationPath: landingLottiePath,
        introTrimEndMs: 350,
        loop: false,
        playbackRate: 1.5,
        trimStartMs: 150
      });
      landingAnim.play();

      const oldAnim = currentVideoAnimation;

      // Espera até que o primeiro frame da animação de pouso esteja carregado e pronto para renderizar
      const checkReadyInterval = setInterval(() => {
        if (landingAnim.canvas) {
          clearInterval(checkReadyInterval);
          
          if (oldAnim && oldAnim.isPlaying && oldAnim !== landingAnim) {
            oldAnim.stop();
          }
          
          if (currentVideoAnimation === oldAnim) {
            currentVideoAnimation = landingAnim;
            console.log("[NexaRenderer] Animação de pouso pronta. Trocando de flutuação para pouso.");
          }
        }
      }, 16);

      // Limite de segurança de 500ms para fallback
      setTimeout(() => {
        clearInterval(checkReadyInterval);
        if (currentVideoAnimation === oldAnim) {
          if (oldAnim && oldAnim.isPlaying) {
            oldAnim.stop();
          }
          currentVideoAnimation = landingAnim;
        }
      }, 500);
    }
  });

  // 4. Inicializa suporte a captura de webcam (Olhos da Nexa)
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
