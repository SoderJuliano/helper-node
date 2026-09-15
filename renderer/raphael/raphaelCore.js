(function(root) {
  const _RaphaelMath = (root && root.RaphaelMath) || (typeof RaphaelMath !== "undefined" ? RaphaelMath : null) || (typeof require !== "undefined" ? require("./raphaelMath.js").RaphaelMath : null);
  const _RAPHAEL_THEMES = (root && root.RAPHAEL_THEMES) || (typeof RAPHAEL_THEMES !== "undefined" ? RAPHAEL_THEMES : {}) || (typeof require !== "undefined" ? require("./raphaelThemes.js").RAPHAEL_THEMES : {});
  const _RaphaelRings = (root && root.RaphaelRings) || (typeof RaphaelRings !== "undefined" ? RaphaelRings : null) || (typeof require !== "undefined" ? require("./raphaelRings.js").RaphaelRings : null);
  const _RaphaelAudioVisualizer = (root && root.RaphaelAudioVisualizer) || (typeof RaphaelAudioVisualizer !== "undefined" ? RaphaelAudioVisualizer : null) || (typeof require !== "undefined" ? require("./raphaelAudioVisualizer.js").RaphaelAudioVisualizer : null);

  class RaphaelCore {
    constructor(options = {}) {
      this.currentState = "IDLE";
      this.targetState = "IDLE";
      this.transitionProgress = 1.0;
      this.transitionSpeed = 2.8; // Transição suave entre estados (~350ms)

      this.currentTheme = { ..._RAPHAEL_THEMES.IDLE };
      this.previousTheme = { ..._RAPHAEL_THEMES.IDLE };

      this.rings = new _RaphaelRings();
      this.audioVisualizer = new _RaphaelAudioVisualizer();

      this.time = 0;
      this.shockwaves = [];
      this.ambientSparks = [];
      this.initAmbientSparks();
    }

    initAmbientSparks() {
      this.ambientSparks = [];
      const count = 35;
      for (let i = 0; i < count; i++) {
        this.ambientSparks.push({
          x: (Math.random() - 0.5) * 260,
          y: (Math.random() - 0.5) * 260,
          z: (Math.random() - 0.5) * 260,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          vz: (Math.random() - 0.5) * 8,
          size: Math.random() * 1.6 + 0.8,
          alpha: Math.random() * 0.5 + 0.2
        });
      }
    }

    /**
     * Conecta um elemento de áudio (TTS) para modulação em tempo real.
     */
    connectAudioElement(audioElement) {
      if (this.audioVisualizer) {
        this.audioVisualizer.connectAudioElement(audioElement);
      }
    }

    /**
     * Altera o estado do Raphael (IDLE, LISTENING, THINKING, SPEAKING, WORKING, SEARCHING, SLEEPING).
     */
    setState(newState) {
      if (!newState || !_RAPHAEL_THEMES[newState]) {
        newState = "IDLE";
      }
      if (this.currentState === newState && this.targetState === newState) return;

      this.previousTheme = { ...this.currentTheme };
      this.targetState = newState;
      this.transitionProgress = 0.0;
      this.triggerShockwave(0.8);
    }

    getCurrentState() {
      return this.targetState;
    }

    /**
     * Dispara uma onda de choque de plasma que se expande do centro para fora.
     */
    triggerShockwave(intensity = 1.0) {
      this.shockwaves.push({
        radius: 10,
        maxRadius: 135,
        speed: 180 + intensity * 90,
        alpha: 0.85 * intensity,
        thickness: 3.5
      });
    }

    /**
     * Atualização lógica a cada frame (60 FPS).
     */
    update(deltaTime) {
      this.time += deltaTime;

      // Atualiza análise de áudio
      const isSpeaking = this.targetState === "SPEAKING";
      this.audioVisualizer.update(deltaTime, isSpeaking);
      const audio = this.audioVisualizer.getMetrics();

      // Dispara choque leve em picos de graves durante fala
      if (isSpeaking && audio.bass > 0.65 && Math.random() < 0.20) {
        this.triggerShockwave(audio.bass * 0.7);
      }

      // Interpolação suave de temas
      if (this.transitionProgress < 1.0) {
        this.transitionProgress = Math.min(1.0, this.transitionProgress + deltaTime * this.transitionSpeed);
        const targetCfg = _RAPHAEL_THEMES[this.targetState] || _RAPHAEL_THEMES.IDLE;
        const amt = this.transitionProgress;

        this.currentTheme = {
          coreColorPrimary: _RaphaelMath.lerpColor(this.previousTheme.coreColorPrimary, targetCfg.coreColorPrimary, amt),
          coreColorSecondary: _RaphaelMath.lerpColor(this.previousTheme.coreColorSecondary, targetCfg.coreColorSecondary, amt),
          coronaColor: _RaphaelMath.lerpColor(this.previousTheme.coronaColor, targetCfg.coronaColor, amt),
          particleColors: targetCfg.particleColors,
          ringRotationSpeed: _RaphaelMath.lerp(this.previousTheme.ringRotationSpeed, targetCfg.ringRotationSpeed, amt),
          pulseSpeed: _RaphaelMath.lerp(this.previousTheme.pulseSpeed, targetCfg.pulseSpeed, amt),
          coreRadius: _RaphaelMath.lerp(this.previousTheme.coreRadius, targetCfg.coreRadius, amt),
          shockwaveIntensity: _RaphaelMath.lerp(this.previousTheme.shockwaveIntensity, targetCfg.shockwaveIntensity, amt)
        };

        if (this.transitionProgress >= 1.0) {
          this.currentState = this.targetState;
        }
      }

      // Atualiza anéis orbitais 3D
      this.rings.update(deltaTime, this.currentTheme, audio, this.time);

      // Atualiza ondas de choque
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.radius += sw.speed * deltaTime;
        sw.alpha *= (1.0 - deltaTime * 2.8);
        if (sw.radius >= sw.maxRadius || sw.alpha <= 0.02) {
          this.shockwaves.splice(i, 1);
        }
      }

      // Atualiza faíscas cósmicas ambientes
      this.ambientSparks.forEach((s) => {
        s.x += s.vx * deltaTime;
        s.y += s.vy * deltaTime;
        s.z += s.vz * deltaTime;

        if (Math.abs(s.x) > 130) s.vx *= -1;
        if (Math.abs(s.y) > 130) s.vy *= -1;
        if (Math.abs(s.z) > 130) s.vz *= -1;
      });
    }

    /**
     * Renderização visual completa no Canvas 2D da janela da Nexa.
     */
    render(ctx, canvasWidth, canvasHeight) {
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const audio = this.audioVisualizer.getMetrics();
      const theme = this.currentTheme;

      // Limpa o canvas transparente
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // 1. Renderiza faíscas cósmicas de fundo
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.ambientSparks.forEach((s) => {
        const proj = _RaphaelMath.project3D(s.x, s.y, s.z, cx, cy, 320);
        const alpha = s.alpha * proj.alpha * (1.0 + audio.treble * 0.8);
        ctx.fillStyle = _RaphaelMath.toRgbaString(theme.coreColorPrimary, alpha);
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, s.size * proj.scale, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // 2. Renderiza ondas de choque de plasma (Shockwaves)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.shockwaves.forEach((sw) => {
        ctx.strokeStyle = _RaphaelMath.toRgbaString(theme.coreColorPrimary, sw.alpha);
        ctx.lineWidth = sw.thickness;
        ctx.beginPath();
        ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();

      // 3. Renderiza as Auréolas Orbitais 3D de Raphael
      this.rings.render(ctx, cx, cy, theme, audio);

      // 4. Renderiza a Corona e o Núcleo de Plasma Central
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Modulação de pulsação e voz
      const pulseFactor = Math.sin(this.time * theme.pulseSpeed) * 0.08;
      const voiceExpansion = audio.bass * 22 + audio.amplitude * 10;
      const baseRadius = Math.max(12, theme.coreRadius * (1.0 + pulseFactor) + voiceExpansion);

      // Corona externa difusa
      const coronaGrad = ctx.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, baseRadius * 2.6);
      coronaGrad.addColorStop(0, _RaphaelMath.toRgbaString(theme.coronaColor, 0.7));
      coronaGrad.addColorStop(0.5, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.4));
      coronaGrad.addColorStop(1, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.0));

      ctx.fillStyle = coronaGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Núcleo interno de energia brilhante
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
      coreGrad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
      coreGrad.addColorStop(0.35, _RaphaelMath.toRgbaString(theme.coreColorPrimary, 0.95));
      coreGrad.addColorStop(0.85, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.8));
      coreGrad.addColorStop(1, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.0));

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Anéis de ressonância geométrica interna
      const innerRingCount = 2;
      for (let r = 0; r < innerRingCount; r++) {
        const ringR = baseRadius * (0.55 + r * 0.28) + Math.sin(this.time * 4 + r) * 3;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + audio.mid * 0.5})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, ringR), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { RaphaelCore };
  }
  if (root) {
    root.RaphaelCore = RaphaelCore;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
