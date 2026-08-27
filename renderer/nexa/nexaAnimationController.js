/**
 * renderer/nexa/nexaAnimationController.js
 * Orquestrador Central de Animação Procedural 2D da Nexa.
 * Integra respiração, olhar, piscar, fala por áudio TTS e transições suaves entre estados.
 */

// Suporte dual Browser / CommonJS Node
const _NexaBreathing = typeof NexaBreathing !== "undefined" ? NexaBreathing : require("./nexaBreathing.js").NexaBreathing;
const _NexaBlink = typeof NexaBlink !== "undefined" ? NexaBlink : require("./nexaBlink.js").NexaBlink;
const _NexaLook = typeof NexaLook !== "undefined" ? NexaLook : require("./nexaLook.js").NexaLook;
const _NexaTalking = typeof NexaTalking !== "undefined" ? NexaTalking : require("./nexaTalking.js").NexaTalking;
const _NexaThinking = typeof NexaThinking !== "undefined" ? NexaThinking : require("./nexaThinking.js").NexaThinking;

class NexaAnimationController {
  constructor(characterInstance) {
    this.character = characterInstance;
    this.currentState = "IDLE";
    this.previousState = "IDLE";
    this.stateTransitionProgress = 1.0;
    this.transitionDuration = 0.3; // 300ms de transição suave entre estados

    // Sub-controladores procedurais isolados
    this.breathing = new _NexaBreathing();
    this.blink = new _NexaBlink();
    this.look = new _NexaLook();
    this.talking = new _NexaTalking();
    this.thinking = new _NexaThinking();

    // Reações procedurais temporárias
    this.activeReaction = null;
    this.reactionTime = 0.0;
    this.reactionDuration = 3.0; // 3 segundos de duração
  }

  playProceduralReaction(name) {
    this.activeReaction = name;
    this.reactionTime = 0.0;
    console.log(`[NexaAnimationController] Iniciando reação procedural: ${name}`);
  }

  setState(newState) {
    const valid = ["IDLE", "LISTENING", "THINKING", "SPEAKING", "WORKING"];
    if (!valid.includes(newState)) {
      console.warn("[NexaAnimationController] Estado inválido:", newState);
      return;
    }

    if (this.currentState === newState) return;

    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateTransitionProgress = 0;

    console.log(`[NexaAnimationController] Transição de Animação: ${this.previousState} -> ${this.currentState}`);

    if (this.currentState !== "SPEAKING") {
      this.talking.stop();
    }
  }

  getCurrentState() {
    return this.currentState;
  }

  connectAudioElement(audioElement) {
    if (this.talking) {
      this.talking.connectAudioElement(audioElement);
    }
  }

  update(deltaTime) {
    if (!this.character) return;

    // Atualiza progresso da transição de estado suave
    if (this.stateTransitionProgress < 1.0) {
      this.stateTransitionProgress += deltaTime / this.transitionDuration;
      if (this.stateTransitionProgress > 1.0) this.stateTransitionProgress = 1.0;
    }

    // 1. Atualiza respiração procedural
    const breath = this.breathing.update(deltaTime, this.currentState);

    // 2. Atualiza piscar de olhos
    const blinkData = this.blink.update(deltaTime, this.currentState);

    // 3. Atualiza olhar e inclinação de cabeça
    const lookData = this.look.update(deltaTime, this.currentState);

    // 4. Atualiza controlador de pensamento (THINKING)
    const thinkingData = this.thinking.update(deltaTime, this.currentState);

    // 5. Atualiza animação de fala sincronizada por áudio TTS
    const isSpeaking = this.currentState === "SPEAKING";
    const talkData = this.talking.update(deltaTime, isSpeaking);

    // 6. Atualiza reações procedurais
    let reactionHeadRot = 0;
    let reactionHeadY = 0;
    let reactionMouthScaleX = 1.0;
    let reactionMouthScaleY = 1.0;
    let reactionMouthOffsetY = 0;

    if (this.activeReaction === "heart") {
      this.reactionTime += deltaTime;
      if (this.reactionTime < this.reactionDuration) {
        const t = this.reactionTime / this.reactionDuration;
        const pulse = Math.sin(t * Math.PI); // Curva senoidal suave de 0 a 1 a 0
        
        reactionHeadRot = 0.12 * pulse;       // Inclina cabeça
        reactionHeadY = 3.0 * pulse;          // Move um pouco para baixo
        reactionMouthScaleX = 1.0 + 0.15 * pulse; // Sorriso horizontal
        reactionMouthScaleY = 1.0 - 0.15 * pulse; // Redução vertical da boca para fazer sorriso
        reactionMouthOffsetY = -2.0 * pulse;
      } else {
        this.activeReaction = null;
      }
    }

    // Aplica transformações combinadas no modelo de camadas do personagem
    const bodyNode = this.character.nodes.body;
    const headNode = this.character.nodes.head;
    const eyesNode = this.character.nodes.eyes;
    const mouthNode = this.character.nodes.mouth;

    // Corpo / Torso: Respiração + inclinação
    bodyNode.y = breath.offsetY;
    bodyNode.scaleY = breath.scaleY;
    bodyNode.rotation = breath.rotation;

    // Cabeça: Movimentos do controlador Look + Thinking + Reação
    headNode.x = lookData.headX;
    headNode.y = lookData.headY + thinkingData.headY + reactionHeadY;
    headNode.rotation = lookData.headRotation + thinkingData.headTilt + reactionHeadRot;

    // Olhos: Pupilas (offsetX/Y), Piscar (scaleY), Thinking
    eyesNode.offsetX = lookData.eyeX + thinkingData.eyeX;
    eyesNode.offsetY = lookData.eyeY + thinkingData.eyeY;
    eyesNode.scaleY = blinkData.eyeScaleY;

    // Mão / Braços: Transição de opacidade para a pose de raciocínio (mão no queixo)
    if (this.character.layerMap) {
      const handChinLayer = this.character.layerMap["hand_pose_chin"];
      const handwearLayer = this.character.layerMap["handwear"];
      const blendSpeed = Math.min(1.0, deltaTime * 8.0);

      if (handChinLayer && handwearLayer) {
        if (thinkingData.handOnChin) {
          handChinLayer.opacity += (1.0 - handChinLayer.opacity) * blendSpeed;
          handwearLayer.opacity += (0.0 - handwearLayer.opacity) * blendSpeed;
        } else {
          handChinLayer.opacity += (0.0 - handChinLayer.opacity) * blendSpeed;
          handwearLayer.opacity += (1.0 - handwearLayer.opacity) * blendSpeed;
        }
      }
    }

    // Sobrancelha: Ajuste de expressão
    if (this.character.layerMap && this.character.layerMap["eyebrow"]) {
      this.character.layerMap["eyebrow"].y = thinkingData.eyebrowY;
    }

    // Boca: Amplitude do áudio e pivô anatômico preservado + Reação
    mouthNode.scaleY = talkData.mouthScaleY * reactionMouthScaleY;
    mouthNode.scaleX = talkData.mouthScaleX * reactionMouthScaleX;
    mouthNode.offsetY = talkData.mouthOffsetY + reactionMouthOffsetY;
  }

  render(ctx, canvasWidth, canvasHeight) {
    if (this.character) {
      this.character.render(ctx, canvasWidth, canvasHeight);
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaAnimationController };
}
