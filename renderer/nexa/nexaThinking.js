/**
 * renderer/nexa/nexaThinking.js
 * Controlador de Animação Procedural do Estado THINKING da Nexa.
 * Gerencia olhar reflexivo, inclinação de cabeça, micro-movimentos
 * e poses probabilísticas (incluindo mão no queixo ocasional) durante
 * o processamento do modelo de IA.
 */

class NexaThinking {
  constructor() {
    this.time = 0;
    this.isThinking = false;

    // Poses probabilísticas de raciocínio
    this.currentPoseType = "GAZE_UP_RIGHT"; // "GAZE_UP_LEFT", "GAZE_UP_RIGHT", "TILT_SIDE", "HAND_CHIN"
    this.handOnChinActive = false;

    this.headTiltTarget = 0;
    this.headYTarget = 0;
    this.eyeXTarget = 0;
    this.eyeYTarget = 0;
    this.handYTarget = 0;
    this.eyebrowYTarget = 0;

    this.currentHeadTilt = 0;
    this.currentHeadY = 0;
    this.currentEyeX = 0;
    this.currentEyeY = 0;
    this.currentHandY = 0;
    this.currentEyebrowY = 0;
  }

  onEnterThinking() {
    this.isThinking = true;
    this.time = 0;

    // Sorteia tipo de pose de pensamento (GAZE_UP_RIGHT, GAZE_UP_LEFT ou TILT_SIDE)
    const rand = Math.random();
    if (rand < 0.35) {
      this.currentPoseType = "GAZE_UP_RIGHT";
    } else if (rand < 0.70) {
      this.currentPoseType = "GAZE_UP_LEFT";
    } else {
      this.currentPoseType = "TILT_SIDE";
    }
    this.handOnChinActive = false;

    this.recalculateTargets();
  }

  onExitThinking() {
    this.isThinking = false;
    this.handOnChinActive = false;
    this.headTiltTarget = 0;
    this.headYTarget = 0;
    this.eyeXTarget = 0;
    this.eyeYTarget = 0;
    this.handYTarget = 0;
    this.eyebrowYTarget = 0;
  }

  recalculateTargets() {
    switch (this.currentPoseType) {
      case "GAZE_UP_RIGHT":
        this.headTiltTarget = -0.04;
        this.headYTarget = -2.0;
        this.eyeXTarget = 4.0;
        this.eyeYTarget = -4.5;
        this.handYTarget = 0;
        this.eyebrowYTarget = -1.5;
        break;
      case "GAZE_UP_LEFT":
        this.headTiltTarget = 0.04;
        this.headYTarget = -2.5;
        this.eyeXTarget = -4.0;
        this.eyeYTarget = -4.0;
        this.handYTarget = 0;
        this.eyebrowYTarget = -1.0;
        break;
      case "TILT_SIDE":
        this.headTiltTarget = 0.06;
        this.headYTarget = 1.0;
        this.eyeXTarget = 2.0;
        this.eyeYTarget = -2.0;
        this.handYTarget = 0;
        this.eyebrowYTarget = 0.5;
        break;
    }
  }

  update(deltaTime, currentState) {
    if (currentState === "THINKING" && !this.isThinking) {
      this.onEnterThinking();
    } else if (currentState !== "THINKING" && this.isThinking) {
      this.onExitThinking();
    }

    if (!this.isThinking) {
      const releaseSpeed = Math.min(1.0, deltaTime * 8.0);
      this.currentHeadTilt += (0 - this.currentHeadTilt) * releaseSpeed;
      this.currentHeadY += (0 - this.currentHeadY) * releaseSpeed;
      this.currentEyeX += (0 - this.currentEyeX) * releaseSpeed;
      this.currentEyeY += (0 - this.currentEyeY) * releaseSpeed;
      this.currentHandY += (0 - this.currentHandY) * releaseSpeed;
      this.currentEyebrowY += (0 - this.currentEyebrowY) * releaseSpeed;

      return {
        headTilt: this.currentHeadTilt,
        headY: this.currentHeadY,
        eyeX: this.currentEyeX,
        eyeY: this.currentEyeY,
        handY: this.currentHandY,
        eyebrowY: this.currentEyebrowY,
        handOnChin: false
      };
    }

    this.time += deltaTime;

    // Micro-movimentos orgânicos durante o pensamento
    const microGazeX = Math.sin(this.time * 2.2) * 0.6;
    const microGazeY = Math.cos(this.time * 1.8) * 0.4;
    const microTilt = Math.sin(this.time * 1.1) * 0.005;

    const lerpSpeed = Math.min(1.0, deltaTime * 5.0);

    this.currentHeadTilt += (this.headTiltTarget + microTilt - this.currentHeadTilt) * lerpSpeed;
    this.currentHeadY += (this.headYTarget - this.currentHeadY) * lerpSpeed;
    this.currentEyeX += (this.eyeXTarget + microGazeX - this.currentEyeX) * lerpSpeed;
    this.currentEyeY += (this.eyeYTarget + microGazeY - this.currentEyeY) * lerpSpeed;
    this.currentHandY += (this.handYTarget - this.currentHandY) * lerpSpeed;
    this.currentEyebrowY += (this.eyebrowYTarget - this.currentEyebrowY) * lerpSpeed;

    return {
      headTilt: this.currentHeadTilt,
      headY: this.currentHeadY,
      eyeX: this.currentEyeX,
      eyeY: this.currentEyeY,
      handY: this.currentHandY,
      eyebrowY: this.currentEyebrowY,
      handOnChin: this.handOnChinActive
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaThinking };
}
