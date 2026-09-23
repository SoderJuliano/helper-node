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

      // Parâmetros de rotação giroscópica 3D da Esfera Central
      this.sphereRotX = 0.25;
      this.sphereRotY = 0.40;
      this.sphereRotZ = 0.15;
      this.sphereRotSpeed = { x: 0.35, y: 0.55, z: 0.25 };

      // Gera os nós de energia na superfície da esfera usando distribuição áurea (Fibonacci Sphere)
      this.surfaceNodeCount = 150;
      this.sphereNodes = _RaphaelMath.fibonacciSphere(this.surfaceNodeCount, 1.0);

      this.initAmbientSparks();
    }

    initAmbientSparks() {
      this.ambientSparks = [];
      const count = 40;
      for (let i = 0; i < count; i++) {
        this.ambientSparks.push({
          x: (Math.random() - 0.5) * 196,
          y: (Math.random() - 0.5) * 196,
          z: (Math.random() - 0.5) * 196,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          vz: (Math.random() - 0.5) * 8,
          size: Math.random() * 1.25 + 0.55,
          alpha: Math.random() * 0.5 + 0.2
        });
      }
    }

    /**
     * Conecta um elemento de áudio para modulação em tempo real.
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
      this.triggerShockwave(0.85);
    }

    getCurrentState() {
      return this.targetState;
    }

    /**
     * Dispara uma onda de choque de plasma que se expande do centro para fora.
     */
    triggerShockwave(intensity = 1.0) {
      this.shockwaves.push({
        radius: 8,
        maxRadius: 102,
        speed: 135 + intensity * 65,
        alpha: 0.85 * intensity,
        thickness: 2.5
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
          nebulaDark: _RaphaelMath.lerpColor(this.previousTheme.nebulaDark || targetCfg.nebulaDark, targetCfg.nebulaDark, amt),
          rimColor: _RaphaelMath.lerpColor(this.previousTheme.rimColor || targetCfg.rimColor, targetCfg.rimColor, amt),
          specularColor: _RaphaelMath.lerpColor(this.previousTheme.specularColor || targetCfg.specularColor, targetCfg.specularColor, amt),
          innerGlowColor: _RaphaelMath.lerpColor(this.previousTheme.innerGlowColor || targetCfg.innerGlowColor, targetCfg.innerGlowColor, amt),
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

      // Rotação giroscópica 3D da Esfera Central
      const speedMult = (this.currentTheme.ringRotationSpeed || 1.0) * (1.0 + audio.mid * 1.6);
      this.sphereRotX += this.sphereRotSpeed.x * speedMult * deltaTime;
      this.sphereRotY += this.sphereRotSpeed.y * speedMult * deltaTime;
      this.sphereRotZ += this.sphereRotSpeed.z * speedMult * deltaTime;

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

        if (Math.abs(s.x) > 98) s.vx *= -1;
        if (Math.abs(s.y) > 98) s.vy *= -1;
        if (Math.abs(s.z) > 98) s.vz *= -1;
      });
    }

    /**
     * Renderiza o fundo cósmico de faíscas estelares.
     */
    renderAmbientSparks(ctx, cx, cy, theme, audio) {
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
    }

    /**
     * Renderiza as ondas de choque de plasma expansivas.
     */
    renderShockwaves(ctx, cx, cy, theme, audio) {
      if (this.shockwaves.length === 0) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      this.shockwaves.forEach((sw) => {
        ctx.strokeStyle = _RaphaelMath.toRgbaString(theme.rimColor || theme.coreColorPrimary, sw.alpha);
        ctx.lineWidth = sw.thickness;
        ctx.beginPath();
        ctx.arc(cx, cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    /**
     * Renderiza a Corona difusa e atmosfera ao redor da Esfera 3D.
     */
    renderBackCorona(ctx, cx, cy, baseRadius, theme, audio) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const coronaRadius = baseRadius * 2.5 + audio.bass * 14;
      const coronaGrad = ctx.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, coronaRadius);
      coronaGrad.addColorStop(0, _RaphaelMath.toRgbaString(theme.coronaColor, 0.75));
      coronaGrad.addColorStop(0.45, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.40));
      coronaGrad.addColorStop(1.0, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.0));

      ctx.fillStyle = coronaGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coronaRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /**
     * Renderiza o corpo 3D volumétrico da Esfera (Sombreamento Raytraced Esférico + Borda Fresnel Neon).
     */
    render3DVolumetricSphereBody(ctx, cx, cy, baseRadius, theme, audio) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";

      // 1. Sombreamento Volumétrico Esférico 3D com foco de luz superior esquerdo
      const lightOffX = cx - baseRadius * 0.28;
      const lightOffY = cy - baseRadius * 0.30;

      const sphereGrad = ctx.createRadialGradient(
        lightOffX, lightOffY, baseRadius * 0.05,
        cx, cy, baseRadius
      );
      sphereGrad.addColorStop(0.00, "rgba(255, 255, 255, 0.98)");
      sphereGrad.addColorStop(0.20, _RaphaelMath.toRgbaString(theme.coreColorPrimary, 0.96));
      sphereGrad.addColorStop(0.55, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.92));
      sphereGrad.addColorStop(0.84, _RaphaelMath.toRgbaString(theme.nebulaDark || { r: 10, g: 15, b: 35, a: 0.95 }, 0.95));
      sphereGrad.addColorStop(0.96, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.85));
      sphereGrad.addColorStop(1.00, _RaphaelMath.toRgbaString(theme.rimColor || theme.coreColorPrimary, 0.40));

      ctx.fillStyle = sphereGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Borda Fresnel Neon Intensa (O anel de luz característico na curvatura da esfera)
      ctx.globalCompositeOperation = "lighter";
      const rimGrad = ctx.createRadialGradient(cx, cy, baseRadius * 0.82, cx, cy, baseRadius * 1.06);
      rimGrad.addColorStop(0.0, _RaphaelMath.toRgbaString(theme.rimColor || theme.coreColorPrimary, 0.0));
      rimGrad.addColorStop(0.65, _RaphaelMath.toRgbaString(theme.rimColor || theme.coreColorPrimary, 0.95));
      rimGrad.addColorStop(1.0, _RaphaelMath.toRgbaString(theme.coreColorPrimary, 0.0));

      ctx.fillStyle = rimGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.06, 0, Math.PI * 2);
      ctx.fill();

      // 3. Vórtice / Pulso de Plasma Central Interno
      const innerRadius = baseRadius * (0.35 + Math.sin(this.time * 3.2) * 0.04 + audio.bass * 0.15);
      const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius);
      innerGrad.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
      innerGrad.addColorStop(0.4, _RaphaelMath.toRgbaString(theme.innerGlowColor || theme.coreColorPrimary, 0.9));
      innerGrad.addColorStop(1.0, _RaphaelMath.toRgbaString(theme.coreColorPrimary, 0.0));

      ctx.fillStyle = innerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    /**
     * Renderiza arcos 3D de latitude, longitude e equador sobre a superfície da esfera.
     * @param {boolean} isFront - Se true renderiza o hemisfério frontal; se false renderiza o traseiro
     */
    render3DSphereArcs(ctx, cx, cy, baseRadius, theme, audio, isFront) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const segments = 48;
      const step = (Math.PI * 2) / segments;

      // Definições de círculos na superfície esférica unitária
      const arcDefinitions = [
        // Equador
        { type: "equator", tiltX: 0.45, tiltY: 0.10, tiltZ: 0.30, latY: 0.0, latR: 1.0 },
        // Latitudes
        { type: "lat-north", tiltX: 0.15, tiltY: 0.40, tiltZ: 0.20, latY: 0.45, latR: Math.sqrt(1 - 0.45 * 0.45) },
        { type: "lat-south", tiltX: 0.15, tiltY: 0.40, tiltZ: 0.20, latY: -0.45, latR: Math.sqrt(1 - 0.45 * 0.45) },
        // Meridianos de Longitude
        { type: "meridian-1", tiltX: 0.85, tiltY: 0.20, tiltZ: 0.0, isMeridian: true, phase: 0 },
        { type: "meridian-2", tiltX: 0.20, tiltY: 0.85, tiltZ: 0.5, isMeridian: true, phase: Math.PI / 2 }
      ];

      arcDefinitions.forEach((arcDef) => {
        for (let i = 0; i < segments; i++) {
          const theta1 = i * step;
          const theta2 = (i + 1) * step;

          let p1, p2;
          if (arcDef.isMeridian) {
            // Círculo meridional polar
            const cos1 = Math.cos(theta1), sin1 = Math.sin(theta1);
            const cos2 = Math.cos(theta2), sin2 = Math.sin(theta2);
            p1 = { x: sin1 * Math.cos(arcDef.phase) * baseRadius, y: cos1 * baseRadius, z: sin1 * Math.sin(arcDef.phase) * baseRadius };
            p2 = { x: sin2 * Math.cos(arcDef.phase) * baseRadius, y: cos2 * baseRadius, z: sin2 * Math.sin(arcDef.phase) * baseRadius };
          } else {
            // Círculo paralelo de latitude / equador
            const r = arcDef.latR * baseRadius;
            const y = arcDef.latY * baseRadius;
            p1 = { x: Math.cos(theta1) * r, y, z: Math.sin(theta1) * r };
            p2 = { x: Math.cos(theta2) * r, y, z: Math.sin(theta2) * r };
          }

          // Rotação 3D com a orientação giroscópica da esfera
          const rot1 = _RaphaelMath.rotate3D(p1.x, p1.y, p1.z, this.sphereRotX + arcDef.tiltX, this.sphereRotY + arcDef.tiltY, this.sphereRotZ + arcDef.tiltZ);
          const rot2 = _RaphaelMath.rotate3D(p2.x, p2.y, p2.z, this.sphereRotX + arcDef.tiltX, this.sphereRotY + arcDef.tiltY, this.sphereRotZ + arcDef.tiltZ);

          const avgZ = (rot1.z + rot2.z) / 2;
          const isSegmentFront = avgZ >= -baseRadius * 0.12;

          if (isFront && !isSegmentFront) continue;
          if (!isFront && isSegmentFront) continue;

          const proj1 = _RaphaelMath.project3D(rot1.x, rot1.y, rot1.z, cx, cy, 320);
          const proj2 = _RaphaelMath.project3D(rot2.x, rot2.y, rot2.z, cx, cy, 320);

          const alpha = isFront
            ? Math.min(1.0, (0.55 + (rot1.z / baseRadius) * 0.45) * (1.0 + audio.mid * 0.4))
            : 0.18;
          const lineWidth = isFront ? (1.3 + audio.mid * 0.7) : 0.8;

          ctx.strokeStyle = isFront
            ? _RaphaelMath.toRgbaString(theme.rimColor || theme.coreColorPrimary, alpha)
            : _RaphaelMath.toRgbaString(theme.coreColorSecondary, alpha);
          ctx.lineWidth = lineWidth;

          ctx.beginPath();
          ctx.moveTo(proj1.x, proj1.y);
          ctx.lineTo(proj2.x, proj2.y);
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    /**
     * Renderiza os nós estelares e malha neural 3D na superfície da esfera.
     */
    render3DSurfaceNodes(ctx, cx, cy, baseRadius, theme, audio, isFront) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const projectedNodes = [];

      for (let i = 0; i < this.sphereNodes.length; i++) {
        const node = this.sphereNodes[i];
        const rot = _RaphaelMath.rotate3D(
          node.baseX * baseRadius,
          node.baseY * baseRadius,
          node.baseZ * baseRadius,
          this.sphereRotX,
          this.sphereRotY,
          this.sphereRotZ
        );

        const isNodeFront = rot.z >= -baseRadius * 0.1;
        if (isFront && !isNodeFront) continue;
        if (!isFront && isNodeFront) continue;

        const proj = _RaphaelMath.project3D(rot.x, rot.y, rot.z, cx, cy, 320);
        projectedNodes.push({
          ...proj,
          worldZ: rot.z,
          normalZ: rot.z / baseRadius,
          nodeIdx: i
        });
      }

      // 1. Ligações de energia entre nós adjacentes na superfície (Neural Lattice)
      if (isFront && projectedNodes.length > 1) {
        const maxDistSq = Math.pow(baseRadius * 0.38, 2);
        for (let i = 0; i < projectedNodes.length; i++) {
          const n1 = projectedNodes[i];
          for (let j = i + 1; j < projectedNodes.length; j++) {
            const n2 = projectedNodes[j];
            const dx = n1.x - n2.x;
            const dy = n1.y - n2.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < maxDistSq) {
              const lineAlpha = (1.0 - Math.sqrt(distSq) / (baseRadius * 0.38)) * 0.35 * Math.max(0, n1.normalZ) * Math.max(0, n2.normalZ);
              if (lineAlpha > 0.02) {
                ctx.strokeStyle = _RaphaelMath.toRgbaString(theme.coreColorPrimary, lineAlpha * (1.0 + audio.treble * 0.5));
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(n1.x, n1.y);
                ctx.lineTo(n2.x, n2.y);
                ctx.stroke();
              }
            }
          }
        }
      }

      // 2. Pontos estelares na superfície
      for (let i = 0; i < projectedNodes.length; i++) {
        const pn = projectedNodes[i];
        const normalFacing = Math.max(0, pn.normalZ);
        const size = isFront
          ? Math.max(0.6, (0.85 + normalFacing * 0.85) * (1.0 + audio.treble * 0.8))
          : 0.6;
        const alpha = isFront
          ? Math.min(1.0, (0.4 + normalFacing * 0.6) * (1.0 + audio.treble * 0.5))
          : 0.15;

        const color = (pn.nodeIdx % 2 === 0) ? theme.rimColor || theme.coreColorPrimary : theme.coreColorPrimary;
        ctx.fillStyle = _RaphaelMath.toRgbaString(color, alpha);
        ctx.beginPath();
        ctx.arc(pn.x, pn.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    /**
     * Renderiza os brilhos especulares 3D que conferem aspecto de cristal/orbe líquido tridimensional.
     */
    render3DSpecularHighlights(ctx, cx, cy, baseRadius, theme, audio) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // 1. Brilho Especular Principal Elíptico (Gloss no topo-esquerdo)
      const specX = cx - baseRadius * 0.32;
      const specY = cy - baseRadius * 0.34;
      const specRadiusX = baseRadius * 0.38;
      const specRadiusY = baseRadius * 0.22;

      ctx.save();
      ctx.translate(specX, specY);
      ctx.rotate(-0.60); // -35 graus de inclinação natural da luz

      const specGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, specRadiusX);
      specGrad.addColorStop(0.0, "rgba(255, 255, 255, 0.85)");
      specGrad.addColorStop(0.4, _RaphaelMath.toRgbaString(theme.specularColor || { r: 255, g: 255, b: 255, a: 0.9 }, 0.60));
      specGrad.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");

      ctx.fillStyle = specGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, specRadiusX, specRadiusY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. Reflexo Secundário de Luz Ambiente (Bounce light na base inferior direita)
      const bounceX = cx + baseRadius * 0.36;
      const bounceY = cy + baseRadius * 0.36;
      const bounceRadius = baseRadius * 0.28;

      const bounceGrad = ctx.createRadialGradient(bounceX, bounceY, 0, bounceX, bounceY, bounceRadius);
      bounceGrad.addColorStop(0.0, _RaphaelMath.toRgbaString(theme.coreColorPrimary, 0.45));
      bounceGrad.addColorStop(1.0, _RaphaelMath.toRgbaString(theme.coreColorSecondary, 0.0));

      ctx.fillStyle = bounceGrad;
      ctx.beginPath();
      ctx.arc(bounceX, bounceY, bounceRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    /**
     * Renderização visual completa no Canvas 2D da janela da Nexa.
     * Ordem de renderização por camadas Z volumétricas autênticas:
     * 1. Faíscas cósmicas no espaço profundo
     * 2. Ondas de choque traseiras
     * 3. Partículas e Auréolas traseiras (Z < 0)
     * 4. Arcos 3D e nós traseiros da Esfera (Z < 0)
     * 5. Corona e Corpo Volumétrico 3D da Esfera (Fresnel + Plasma)
     * 6. Partículas e Auréolas frontais (Z >= 0)
     * 7. Arcos 3D e nós frontais da Esfera (Z >= 0)
     * 8. Brilho especular 3D (Gloss / Cristal)
     */
    render(ctx, canvasWidth, canvasHeight) {
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const audio = this.audioVisualizer.getMetrics();
      const theme = this.currentTheme;

      // Limpa o canvas transparente
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Modulação de pulsação e voz
      const pulseFactor = Math.sin(this.time * theme.pulseSpeed) * 0.07;
      const voiceExpansion = audio.bass * 14 + audio.amplitude * 5.6;
      const baseRadius = Math.max(12, theme.coreRadius * (1.0 + pulseFactor) + voiceExpansion);

      // Camada 1: Faíscas cósmicas de fundo
      this.renderAmbientSparks(ctx, cx, cy, theme, audio);

      // Camada 2: Ondas de choque de plasma
      this.renderShockwaves(ctx, cx, cy, theme, audio);

      // Camada 3: Auréolas orbitais TRASEIRAS (Z < 0)
      this.rings.render(ctx, cx, cy, theme, audio, "back");

      // Camada 4: Arcos 3D e nós de energia TRASEIROS da Esfera (Z < 0)
      this.render3DSphereArcs(ctx, cx, cy, baseRadius, theme, audio, false);
      this.render3DSurfaceNodes(ctx, cx, cy, baseRadius, theme, audio, false);

      // Camada 5: Atmosfera Corona + Corpo Volumétrico 3D da Esfera + Borda Fresnel Neon
      this.renderBackCorona(ctx, cx, cy, baseRadius, theme, audio);
      this.render3DVolumetricSphereBody(ctx, cx, cy, baseRadius, theme, audio);

      // Camada 6: Auréolas orbitais FRONTAIS (Z >= 0)
      this.rings.render(ctx, cx, cy, theme, audio, "front");

      // Camada 7: Arcos 3D e nós de energia FRONTAIS da Esfera (Z >= 0)
      this.render3DSphereArcs(ctx, cx, cy, baseRadius, theme, audio, true);
      this.render3DSurfaceNodes(ctx, cx, cy, baseRadius, theme, audio, true);

      // Camada 8: Especulares 3D de Cristal / Gloss
      this.render3DSpecularHighlights(ctx, cx, cy, baseRadius, theme, audio);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { RaphaelCore };
  }
  if (root) {
    root.RaphaelCore = RaphaelCore;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
