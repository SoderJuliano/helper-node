(function(root) {
  const _RaphaelMath = (root && root.RaphaelMath) || (typeof RaphaelMath !== "undefined" ? RaphaelMath : null) || (typeof require !== "undefined" ? require("./raphaelMath.js").RaphaelMath : null);

  class RaphaelRings {
    constructor(options = {}) {
      this.ringDefinitions = [
        {
          id: "inner",
          radius: 62,
          thickness: 8,
          particleCount: 85,
          rx: 0.45,
          ry: 0.20,
          rz: 0.0,
          rotSpeedX: 0.25,
          rotSpeedY: 0.55,
          rotSpeedZ: 0.35,
          currentRotX: 0.2,
          currentRotY: 0.1,
          currentRotZ: 0.0
        },
        {
          id: "middle-inner",
          radius: 84,
          thickness: 10,
          particleCount: 105,
          rx: -0.40,
          ry: 0.85,
          rz: 0.20,
          rotSpeedX: -0.35,
          rotSpeedY: -0.45,
          rotSpeedZ: 0.55,
          currentRotX: -0.2,
          currentRotY: 0.5,
          currentRotZ: 0.1
        },
        {
          id: "middle-outer",
          radius: 106,
          thickness: 12,
          particleCount: 120,
          rx: 0.75,
          ry: -0.55,
          rz: 0.65,
          rotSpeedX: 0.45,
          rotSpeedY: 0.35,
          rotSpeedZ: -0.45,
          currentRotX: 0.4,
          currentRotY: -0.3,
          currentRotZ: 0.2
        },
        {
          id: "outer",
          radius: 128,
          thickness: 14,
          particleCount: 130,
          rx: -0.60,
          ry: -0.80,
          rz: 0.40,
          rotSpeedX: -0.20,
          rotSpeedY: 0.60,
          rotSpeedZ: 0.30,
          currentRotX: 0.1,
          currentRotY: -0.5,
          currentRotZ: 0.4
        }
      ];

      this.particles = [];
      this.sphericalParticles = [];
      this.initParticles();
      this.initSphericalParticles();
    }

    initParticles() {
      this.particles = [];
      this.ringDefinitions.forEach((ring, ringIdx) => {
        for (let i = 0; i < ring.particleCount; i++) {
          const baseAngle = (i / ring.particleCount) * Math.PI * 2;
          const radiusNoise = (Math.random() - 0.5) * ring.thickness;
          const yNoise = (Math.random() - 0.5) * (ring.thickness * 0.85);
          const baseSize = Math.random() * 2.2 + 1.2;
          const sparkRate = Math.random() * 0.05 + 0.02;

          // Gradiente HSL multi-espectral inspirado no código Three.js de referência
          const hueFraction = (ringIdx / this.ringDefinitions.length) * 0.6 + (i / ring.particleCount) * 0.4;

          this.particles.push({
            ringIdx,
            baseAngle,
            angle: baseAngle,
            radiusNoise,
            yNoise,
            baseSize,
            sparkRate,
            sparkPhase: Math.random() * Math.PI * 2,
            hueFraction,
            colorIdx: i % 5
          });
        }
      });
    }

    initSphericalParticles() {
      this.sphericalParticles = [];
      const count = 130;
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const baseRadius = 52 + Math.random() * 75;
        this.sphericalParticles.push({
          theta,
          phi,
          baseRadius,
          rotSpeedTheta: (Math.random() - 0.5) * 0.65,
          rotSpeedPhi: (Math.random() - 0.5) * 0.45,
          size: Math.random() * 1.8 + 0.9,
          sparkPhase: Math.random() * Math.PI * 2,
          sparkRate: Math.random() * 0.06 + 0.02,
          hueFraction: Math.random(),
          colorIdx: i % 5
        });
      }
    }

    /**
     * Atualiza as posições e rotações 3D a cada frame.
     * @param {number} deltaTime 
     * @param {object} theme - Configurações do estado atual
     * @param {object} audioMetrics - { bass, mid, treble, amplitude }
     * @param {number} time - Tempo total decorrido em segundos
     */
    update(deltaTime, theme, audioMetrics, time) {
      const rotSpeedMultiplier = (theme.ringRotationSpeed || 1.0) * (1.0 + audioMetrics.mid * 1.8);
      const audioExpansion = audioMetrics.bass * 25;

      // Atualiza matrizes de rotação dos anéis
      this.ringDefinitions.forEach((ring) => {
        ring.currentRotX += ring.rotSpeedX * rotSpeedMultiplier * deltaTime;
        ring.currentRotY += ring.rotSpeedY * rotSpeedMultiplier * deltaTime;
        ring.currentRotZ += ring.rotSpeedZ * rotSpeedMultiplier * deltaTime;
      });

      // Atualiza partículas dos anéis orbitais
      const waveFreq = 6;
      const waveAmp = (theme.shockwaveIntensity || 0.3) * 8 + audioMetrics.mid * 12;

      this.particles.forEach((p) => {
        const ring = this.ringDefinitions[p.ringIdx];
        p.sparkPhase += p.sparkRate * (1.0 + audioMetrics.treble * 3.0);

        // Movimento angular individual ao longo do anel
        p.angle = (p.baseAngle + time * 0.20 * (p.ringIdx % 2 === 0 ? 1 : -1)) % (Math.PI * 2);

        // Ondulação harmônica senoidal
        const wave = Math.sin(p.angle * waveFreq + time * 3.5) * waveAmp;
        const currentRadius = ring.radius + p.radiusNoise + audioExpansion + wave;

        // Ponto 3D no plano local do anel
        const localX = Math.cos(p.angle) * currentRadius;
        const localY = p.yNoise + Math.sin(p.angle * 3 + time * 2) * (ring.thickness * 0.3);
        const localZ = Math.sin(p.angle) * currentRadius;

        // Rotaciona nos eixos 3D com as orientações do anel
        const rot = _RaphaelMath.rotate3D(
          localX, localY, localZ,
          ring.rx + ring.currentRotX,
          ring.ry + ring.currentRotY,
          ring.rz + ring.currentRotZ
        );

        p.worldX = rot.x;
        p.worldY = rot.y;
        p.worldZ = rot.z;
      });

      // Atualiza partículas da nuvem esférica
      this.sphericalParticles.forEach((sp) => {
        sp.theta += sp.rotSpeedTheta * rotSpeedMultiplier * deltaTime;
        sp.phi += sp.rotSpeedPhi * rotSpeedMultiplier * deltaTime;
        sp.sparkPhase += sp.sparkRate * (1.0 + audioMetrics.treble * 2.5);

        const r = sp.baseRadius + audioExpansion * 0.6;
        sp.worldX = r * Math.sin(sp.phi) * Math.cos(sp.theta);
        sp.worldY = r * Math.sin(sp.phi) * Math.sin(sp.theta);
        sp.worldZ = r * Math.cos(sp.phi);
      });
    }

    /**
     * Renderiza as partículas projetadas em profundidade no Canvas 2D.
     * Suporta filtragem por camada ("back", "front", "all") para permitir que a Esfera 3D
     * seja desenhada perfeitamente no meio volumétrico das auréolas.
     * 
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} centerX 
     * @param {number} centerY 
     * @param {object} theme 
     * @param {object} audioMetrics 
     * @param {string} layerFilter - "all" | "back" (z < 0) | "front" (z >= 0)
     */
    render(ctx, centerX, centerY, theme, audioMetrics, layerFilter = "all") {
      const allParticles = [];

      // Partículas dos anéis
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (layerFilter === "back" && p.worldZ >= 0) continue;
        if (layerFilter === "front" && p.worldZ < 0) continue;

        const proj = _RaphaelMath.project3D(p.worldX, p.worldY, p.worldZ, centerX, centerY, 320);
        allParticles.push({
          ...proj,
          particle: p,
          size: p.baseSize
        });
      }

      // Partículas da nuvem esférica
      for (let i = 0; i < this.sphericalParticles.length; i++) {
        const sp = this.sphericalParticles[i];
        if (layerFilter === "back" && sp.worldZ >= 0) continue;
        if (layerFilter === "front" && sp.worldZ < 0) continue;

        const proj = _RaphaelMath.project3D(sp.worldX, sp.worldY, sp.worldZ, centerX, centerY, 320);
        allParticles.push({
          ...proj,
          particle: sp,
          size: sp.size
        });
      }

      if (allParticles.length === 0) return;

      // Z-Sorting (do mais distante para o mais próximo no eixo Z)
      allParticles.sort((a, b) => a.z - b.z);

      const palette = theme.particleColors || [
        { r: 0, g: 240, b: 255 },
        { r: 74, g: 0, b: 224 },
        { r: 0, g: 255, b: 200 }
      ];

      ctx.save();
      // Modo aditivo para brilho celestial intenso
      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < allParticles.length; i++) {
        const item = allParticles[i];
        const p = item.particle;
        const color = palette[p.colorIdx % palette.length];

        const spark = 0.7 + 0.3 * Math.sin(p.sparkPhase);
        const audioGlow = 1.0 + audioMetrics.treble * 1.5;
        const finalAlpha = Math.min(1.0, item.alpha * spark * audioGlow);
        const finalSize = Math.max(0.8, item.size * item.scale * (1.0 + audioMetrics.amplitude * 0.8));

        // Gradiente radial para cada partícula (efeito de pontinho estelar brilhante)
        const grad = ctx.createRadialGradient(
          item.x, item.y, 0,
          item.x, item.y, finalSize * 2.4
        );
        grad.addColorStop(0, `rgba(255, 255, 255, ${finalAlpha})`);
        grad.addColorStop(0.35, `rgba(${color.r}, ${color.g}, ${color.b}, ${finalAlpha * 0.9})`);
        grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(item.x, item.y, finalSize * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { RaphaelRings };
  }
  if (root) {
    root.RaphaelRings = RaphaelRings;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
