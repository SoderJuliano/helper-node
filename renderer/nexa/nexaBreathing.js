/**
 * renderer/nexa/nexaBreathing.js
 * Controlador de respiração procedural usando ondas senoidais multi-frequência.
 * Evita movimentos mecânicos e ajusta intensidade por estado.
 */

class NexaBreathing {
  constructor() {
    this.time = 0;
    this.intensity = 1.0;
    this.targetIntensity = 1.0;

    this.bodyOffsetY = 0;
    this.bodyScaleY = 1.0;
    this.bodyRotation = 0;
  }

  setIntensity(val) {
    this.targetIntensity = Math.max(0.2, Math.min(2.0, val));
  }

  update(deltaTime, stateName = "IDLE") {
    this.time += deltaTime;

    // Suaviza ajuste de intensidade por estado
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1.0, deltaTime * 3.0);

    // Ajusta parâmetros de frequência/amplitude com base no estado
    let speed = 1.2;
    let ampY = 2.5;
    let ampScale = 0.006;
    let ampRot = 0.003;

    if (stateName === "LISTENING") {
      speed = 0.8;
      ampY = 1.2;
      ampScale = 0.003;
      ampRot = 0.0015;
    } else if (stateName === "THINKING") {
      speed = 1.0;
      ampY = 1.5;
      ampScale = 0.004;
      ampRot = 0.002;
    } else if (stateName === "SPEAKING") {
      speed = 1.8;
      ampY = 3.2;
      ampScale = 0.008;
      ampRot = 0.004;
    }

    const t = this.time * speed;

    // Combinações de senos para movimento orgânico não mecânico
    const wavePrimary = Math.sin(t);
    const waveSecondary = Math.sin(t * 2.3 + 0.4) * 0.3;
    const waveTertiary = Math.cos(t * 0.7 + 1.2) * 0.15;
    const combinedWave = wavePrimary + waveSecondary + waveTertiary;

    this.bodyOffsetY = combinedWave * ampY * this.intensity;
    this.bodyScaleY = 1.0 + Math.sin(t * 0.9) * ampScale * this.intensity;
    this.bodyRotation = Math.sin(t * 0.6 + 0.8) * ampRot * this.intensity;

    return {
      offsetY: this.bodyOffsetY,
      scaleY: this.bodyScaleY,
      rotation: this.bodyRotation
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaBreathing };
}
