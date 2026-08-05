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
  }

  setState(newState) {
    const valid = ["IDLE", "LISTENING", "THINKING", "SPEAKING"];
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

    // 4. Atualiza animação de fala sincronizada por áudio TTS
    const isSpeaking = this.currentState === "SPEAKING";
    const talkData = this.talking.update(deltaTime, isSpeaking);

    // Aplica transformações combinadas no modelo de camadas do personagem
    const bodyNode = this.character.nodes.body;
    const headNode = this.character.nodes.head;
    const eyesNode = this.character.nodes.eyes;
    const mouthNode = this.character.nodes.mouth;

    // Corpo / Torso: Respiração + inclinação
    bodyNode.y = breath.offsetY;
    bodyNode.scaleY = breath.scaleY;
    bodyNode.rotation = breath.rotation;

    // Cabeça: Movimentos do controlador Look
    headNode.x = lookData.headX;
    headNode.y = lookData.headY;
    headNode.rotation = lookData.headRotation;

    // Olhos: Pupilas (offsetX/Y), Piscar (scaleY)
    eyesNode.offsetX = lookData.eyeX;
    eyesNode.offsetY = lookData.eyeY;
    eyesNode.scaleY = blinkData.eyeScaleY;

    // Boca: Amplitude do áudio e pivô anatômico preservado
    mouthNode.scaleY = talkData.mouthScaleY;
    mouthNode.scaleX = talkData.mouthScaleX;
    mouthNode.offsetY = talkData.mouthOffsetY;
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
