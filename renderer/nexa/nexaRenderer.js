/**
 * renderer/nexa/nexaRenderer.js
 * Loop principal de renderização HTML5 2D Canvas via requestAnimationFrame,
 * escuta de IPCs Electron e integração de áudio Google TTS.
 */

document.addEventListener("DOMContentLoaded", async () => {
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
    window.electronAPI.onNexaStateChange(({ state }) => {
      console.log("[NexaRenderer] Novo estado recebido via IPC:", state);
      animController.setState(state);
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

    // Se o estado mudar de IDLE, interrompe a animação de tédio imediatamente
    if (currentState !== "IDLE") {
      if (currentVideoAnimation && currentVideoAnimation.isPlaying && !currentVideoAnimation.isFinished()) {
        if (currentVideoAnimation === idleBoringAnimation || currentVideoAnimation !== introAnimation) {
          currentVideoAnimation.stop();
          console.log("[NexaRenderer] Animação de vídeo interrompida por mudança de estado para:", currentState);
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

      // Sorteio aleatório para a animação idle/boring
      if (currentState === "IDLE" && (!introAnimation || introAnimation.isFinished())) {
        idleTime += deltaTime;
        if (idleTime >= 4.0) {
          idleTime = 0;
          if (Math.random() < 0.25) {
            console.log("[NexaRenderer] Sorteando animação idle/boring de 8s...");
            if (idleBoringAnimation) {
              idleBoringAnimation.play();
              currentVideoAnimation = idleBoringAnimation;
            }
          }
        }
      }
    }

    requestAnimationFrame(renderLoop);
  }

  // Obtém o estado inicial do Main
  if (window.electronAPI && window.electronAPI.getNexaState) {
    window.electronAPI.getNexaState().then((state) => {
      if (state) animController.setState(state);
    }).catch(() => {});
  }

  requestAnimationFrame(renderLoop);
});
