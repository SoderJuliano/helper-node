/**
 * renderer/nexa/nexaLook.js
 * Controlador de olhar e micro-movimentos de cabeça com interpolação suave (lerp).
 */

class NexaLook {
  constructor() {
    this.time = 0;

    // Alvos atuais (target) e valores interpolados (current)
    this.targetHeadRotation = 0;
    this.targetHeadX = 0;
    this.targetHeadY = 0;
    this.targetEyeX = 0;
    this.targetEyeY = 0;

    this.currentHeadRotation = 0;
    this.currentHeadX = 0;
    this.currentHeadY = 0;
    this.currentEyeX = 0;
    this.currentEyeY = 0;

    this.changeTimer = 0;
    this.nextChangeInterval = 3.0;
  }

  update(deltaTime, stateName = "IDLE") {
    this.time += deltaTime;
    this.changeTimer += deltaTime;

    if (this.changeTimer >= this.nextChangeInterval) {
      this.changeTimer = 0;
      this.nextChangeInterval = 2.0 + Math.random() * 4.0;
      this.recalculateTargets(stateName);
    }

    // Adiciona micro-vibração orgânica contínua
    const microNoiseX = Math.sin(this.time * 1.7) * 0.8 + Math.cos(this.time * 2.9) * 0.4;
    const microNoiseY = Math.cos(this.time * 1.4) * 0.6 + Math.sin(this.time * 2.3) * 0.3;
    const microRot = Math.sin(this.time * 0.9) * 0.004;

    // Lerp suave em direção aos alvos
    const lerpSpeed = Math.min(1.0, deltaTime * 3.5);

    this.currentHeadRotation += (this.targetHeadRotation + microRot - this.currentHeadRotation) * lerpSpeed;
    this.currentHeadX += (this.targetHeadX + microNoiseX - this.currentHeadX) * lerpSpeed;
    this.currentHeadY += (this.targetHeadY + microNoiseY - this.currentHeadY) * lerpSpeed;

    this.currentEyeX += (this.targetEyeX + microNoiseX * 0.5 - this.currentEyeX) * lerpSpeed;
    this.currentEyeY += (this.targetEyeY + microNoiseY * 0.5 - this.currentEyeY) * lerpSpeed;

    return {
      headRotation: this.currentHeadRotation,
      headX: this.currentHeadX,
      headY: this.currentHeadY,
      eyeX: this.currentEyeX,
      eyeY: this.currentEyeY
    };
  }

  recalculateTargets(stateName) {
    if (stateName === "LISTENING") {
      // Cabeça levemente inclinada de lado e atenção para frente
      this.targetHeadRotation = (Math.random() > 0.5 ? 1 : -1) * (0.04 + Math.random() * 0.03);
      this.targetHeadX = (Math.random() - 0.5) * 2.0;
      this.targetHeadY = 1.5 + Math.random() * 2.0;
      this.targetEyeX = (Math.random() - 0.5) * 2.0;
      this.targetEyeY = 1.0 + Math.random() * 1.5;
    } else if (stateName === "THINKING") {
      // Olhar inclinado para cima e para o lado (pensativo)
      this.targetHeadRotation = (Math.random() > 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.04);
      this.targetHeadX = (Math.random() > 0.5 ? 1 : -1) * (3.0 + Math.random() * 3.0);
      this.targetHeadY = -2.0 - Math.random() * 2.0;
      this.targetEyeX = (Math.random() > 0.5 ? 1 : -1) * (4.0 + Math.random() * 3.0);
      this.targetEyeY = -3.0 - Math.random() * 2.0;
    } else if (stateName === "SPEAKING") {
      // Movimentos dinâmicos de fala
      this.targetHeadRotation = (Math.random() - 0.5) * 0.06;
      this.targetHeadX = (Math.random() - 0.5) * 4.0;
      this.targetHeadY = (Math.random() - 0.5) * 3.0;
      this.targetEyeX = (Math.random() - 0.5) * 3.0;
      this.targetEyeY = (Math.random() - 0.5) * 2.0;
    } else {
      // IDLE - Posição central relaxada com variação sutil
      this.targetHeadRotation = (Math.random() - 0.5) * 0.03;
      this.targetHeadX = (Math.random() - 0.5) * 2.5;
      this.targetHeadY = (Math.random() - 0.5) * 2.0;
      this.targetEyeX = (Math.random() - 0.5) * 2.5;
      this.targetEyeY = (Math.random() - 0.5) * 2.0;
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaLook };
}
