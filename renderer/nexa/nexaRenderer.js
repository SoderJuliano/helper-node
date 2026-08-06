/**
 * renderer/nexa/nexaRenderer.js
 * Loop principal de renderização HTML5 2D Canvas via requestAnimationFrame,
 * escuta de IPCs Electron e integração de áudio Google TTS.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Redireciona logs do console do renderer para o main process
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args) => {
    originalLog(...args);
    if (window.electronAPI && window.electronAPI.logToMain) {
      window.electronAPI.logToMain("log", args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(" "));
    }
  };
  console.error = (...args) => {
    originalError(...args);
    if (window.electronAPI && window.electronAPI.logToMain) {
      window.electronAPI.logToMain("error", args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(" "));
    }
  };
  console.warn = (...args) => {
    originalWarn(...args);
    if (window.electronAPI && window.electronAPI.logToMain) {
      window.electronAPI.logToMain("warn", args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(" "));
    }
  };

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

  // Caminho absoluto das camadas PNG geradas
  const assetsPath = "/home/soder/Documents/nexa-workspace/see-through/workspace/layerdiff_output/Nexa_front_cutout";
  const loaded = await character.loadAssets(assetsPath);
  if (!loaded) {
    console.error("[NexaRenderer] Erro crítico ao carregar camadas PNG.");
  }

  // Inicializa o reprodutor de animação de entrada 2D
  const introAnimation = typeof NexaIntroAnimation !== "undefined" ? new NexaIntroAnimation({ introTrimEndMs }) : null;
  if (introAnimation) {
    introAnimation.play();
  }

  // Inicializa a animação de tédio/idle (Animated_anime_girl_idling_202608051517.mp4)
  const idleBoringPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Animated_anime_girl_idling_202608051517.mp4";
  const idleBoringAnimation = typeof NexaIntroAnimation !== "undefined"
    ? new NexaIntroAnimation({ videoPath: idleBoringPath, introTrimEndMs })
    : null;

  // Inicializa a animação de ajustar óculos/idle (Animated_character_adjusting_gla…_202608052214.mp4)
  const idleGlassesPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Animated_character_adjusting_gla…_202608052214.mp4";
  const idleGlassesAnimation = typeof NexaIntroAnimation !== "undefined"
    ? new NexaIntroAnimation({ videoPath: idleGlassesPath, introTrimEndMs })
    : null;

  let currentVideoAnimation = introAnimation;
  let idleTime = 0;

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

      if (animDef.videoPath) {
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
        const listeningPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_listening_animation_202608052231.mp4";
        console.log("[NexaRenderer] Transicionando para LISTENING. Iniciando animação de escuta.");
        currentVideoAnimation = new NexaIntroAnimation({
          videoPath: listeningPath,
          introTrimEndMs,
          loop: false
        });
        currentVideoAnimation.play();
      } else if (newState === "THINKING") {
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          currentVideoAnimation.stop();
        }
        const thinkingPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_thinking_poses_202608052317.mp4";
        console.log("[NexaRenderer] Transicionando para THINKING. Iniciando animação de pensamento.");
        currentVideoAnimation = new NexaIntroAnimation({
          videoPath: thinkingPath,
          introTrimEndMs,
          loop: true // loop while waiting for AI
        });
        currentVideoAnimation.play();
      } else {
        // Se mudou para qualquer outro estado (como SPEAKING ou IDLE), para animações de escuta ou pensamento
        if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
          const pathStr = currentVideoAnimation.videoPath || "";
          if (pathStr.includes("thinking") || pathStr.includes("listening")) {
            console.log("[NexaRenderer] Parando animação de escuta/pensamento por transição de estado.");
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
      
      const isCustomAnimPlaying = currentVideoAnimation && 
                                  currentVideoAnimation.isPlaying && 
                                  !currentVideoAnimation.isFinished() &&
                                  currentVideoAnimation !== introAnimation && 
                                  currentVideoAnimation !== idleBoringAnimation;
      
      if (isCustomAnimPlaying) {
        console.log("[NexaRenderer] Atrasando áudio TTS em 2s para priorizar animação de vídeo...");
        setTimeout(() => {
          playTtsAudio(audioBase64);
        }, 2000);
      } else {
        playTtsAudio(audioBase64);
      }
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
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      };

      currentAudio.onerror = (err) => {
        console.error("[NexaRenderer] Erro no áudio TTS:", err);
        currentAudio = null;
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      };

      currentAudio.play().catch((err) => {
        console.error("[NexaRenderer] Falha na reprodução:", err);
        animController.setState("IDLE");
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      });
    } catch (e) {
      console.error("[NexaRenderer] Exceção ao tocar TTS:", e);
      animController.setState("IDLE");
      if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
        window.electronAPI.sendNexaTtsEnded();
      }
    }
  }

  // 3. Loop Principal de Renderização 60FPS (requestAnimationFrame)
  function renderLoop(currentTime) {
    const deltaTime = Math.min(0.1, (currentTime - lastTime) / 1000.0);
    lastTime = currentTime;

    const currentState = animController.getCurrentState();

    // Se o estado mudar de IDLE, interrompe a animação de tédio ou óculos imediatamente
    if (currentState !== "IDLE") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && !currentVideoAnimation.isFinished()) {
        if (currentVideoAnimation === idleBoringAnimation || currentVideoAnimation === idleGlassesAnimation) {
          currentVideoAnimation.stop();
          console.log("[NexaRenderer] Animação de tédio/óculos interrompida por mudança de estado para:", currentState);
        }
      }
      idleTime = 0;
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
      animController.render(ctx, canvas.width, canvas.height);

      // Sorteio aleatório para a animação idle (tédio ou óculos)
      if (currentState === "IDLE" && (!introAnimation || introAnimation.isFinished())) {
        idleTime += deltaTime;
        if (idleTime >= 4.0) {
          idleTime = 0;
          if (Math.random() < 0.25) {
            const showGlasses = Math.random() < 0.5;
            if (showGlasses && idleGlassesAnimation) {
              console.log("[NexaRenderer] Sorteando animação de ajustar óculos...");
              idleGlassesAnimation.play();
              currentVideoAnimation = idleGlassesAnimation;
            } else if (idleBoringAnimation) {
              console.log("[NexaRenderer] Sorteando animação idle/boring...");
              idleBoringAnimation.play();
              currentVideoAnimation = idleBoringAnimation;
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

      // Interrompe a animação de vídeo atual
      if (currentVideoAnimation && currentVideoAnimation.isPlaying) {
        currentVideoAnimation.stop();
      }

      // Inicia a animação de flutuar (floating) em loop
      const floatingPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_floating_in_air_202608051113.mp4";
      console.log("[NexaRenderer] Arrastando janela. Iniciando animação de flutuação.");
      currentVideoAnimation = new NexaIntroAnimation({
        videoPath: floatingPath,
        introTrimEndMs,
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

      // Prepara a animação de queda/aterrissagem (landing) sem loop, a 1.5x de velocidade,
      // cortando os primeiros 150ms (piscada estática) e os últimos 350ms (quadrado branco do final)
      const landingPath = "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_lands_on_feet_202608051122.mp4";
      console.log("[NexaRenderer] Soltou janela. Iniciando carregamento do pouso...");
      
      const landingAnim = new NexaIntroAnimation({
        videoPath: landingPath,
        introTrimEndMs: 350,
        loop: false,
        playbackRate: 1.5,
        trimStartMs: 150
      });
      landingAnim.play();

      const oldAnim = currentVideoAnimation;

      // Espera até que o primeiro frame da animação de pouso esteja carregado e pronto para renderizar
      const checkReadyInterval = setInterval(() => {
        if (landingAnim.video && landingAnim.video.readyState >= 3) {
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

  // 4. Lógica de captura de webcam (Olhos da Nexa)
  let webcamStream = null;

  async function captureWebcamFrame() {
    try {
      if (!webcamStream) {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      }
      const tempVideo = document.createElement("video");
      tempVideo.srcObject = webcamStream;
      tempVideo.play();

      // Aguarda até o vídeo ter os metadados prontos
      await new Promise((resolve) => {
        tempVideo.onloadedmetadata = () => resolve();
      });

      // Aguarda 300ms para a câmera ajustar exposição/foco
      await new Promise(resolve => setTimeout(resolve, 300));

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = 640;
      tempCanvas.height = 480;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(tempVideo, 0, 0, 640, 480);

      tempVideo.pause();
      tempVideo.srcObject = null;

      // Retorna em formato base64
      return tempCanvas.toDataURL("image/jpeg");
    } catch (err) {
      console.error("[NexaRenderer] Falha ao capturar webcam:", err.message);
      return null;
    }
  }

  if (window.electronAPI && window.electronAPI.onRequestWebcam) {
    window.electronAPI.onRequestWebcam(async ({ requestId }) => {
      console.log("[NexaRenderer] Solicitação de webcam recebida. Capturando frame...");
      const base64 = await captureWebcamFrame();
      if (window.electronAPI.sendWebcamReply) {
        window.electronAPI.sendWebcamReply(requestId, base64);
      }
    });
  }

  // Obtém o estado inicial do Main
  if (window.electronAPI && window.electronAPI.getNexaState) {
    window.electronAPI.getNexaState().then((state) => {
      if (state) animController.setState(state);
    }).catch(() => {});
  }

  requestAnimationFrame(renderLoop);
});
