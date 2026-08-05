/**
 * renderer/nexa/nexaBlink.js
 * Gerador de piscar de olhos pseudo-aleatório e suave.
 */

class NexaBlink {
  constructor() {
    this.timer = 0;
    this.nextBlinkInterval = this.getNewInterval();

    this.isBlinking = false;
    this.blinkProgress = 0;
    this.blinkDuration = 0.15; // 150ms de piscar rápido

    this.eyeScaleY = 1.0;
  }

  getNewInterval() {
    // Intervalo pseudo-aleatório entre 2.5s e 6s
    return 2.5 + Math.random() * 3.5;
  }

  update(deltaTime, stateName = "IDLE") {
    this.timer += deltaTime;

    if (!this.isBlinking) {
      if (this.timer >= this.nextBlinkInterval) {
        this.isBlinking = true;
        this.blinkProgress = 0;
        this.timer = 0;
        this.nextBlinkInterval = this.getNewInterval();
      }
    } else {
      this.blinkProgress += deltaTime / this.blinkDuration;

      if (this.blinkProgress >= 1.0) {
        this.isBlinking = false;
        this.eyeScaleY = 1.0;
      } else {
        // Onda senoidal de fechamento (1 -> 0 -> 1)
        const phase = Math.sin(this.blinkProgress * Math.PI);
        this.eyeScaleY = Math.max(0.02, 1.0 - phase * 0.98);
      }
    }

    return {
      eyeScaleY: this.eyeScaleY,
      isBlinking: this.isBlinking
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaBlink };
}
