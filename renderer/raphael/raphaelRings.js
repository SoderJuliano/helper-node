const _RaphaelMath = typeof RaphaelMath !== "undefined" ? RaphaelMath : (typeof require !== "undefined" ? require("./raphaelMath.js").RaphaelMath : null);

class RaphaelRings {
  constructor(options = {}) {
    this.ringDefinitions = [
      {
        id: "inner",
        radius: 65,
        thickness: 7,
        particleCount: 75,
        rx: 0.45,
        ry: 0.20,
        rz: 0.0,
        rotSpeedX: 0.2,
        rotSpeedY: 0.5,
        rotSpeedZ: 0.3,
        currentRotX: 0.2,
        currentRotY: 0.1,
        currentRotZ: 0.0,
        hueOffset: 0.0
      },
      {
        id: "middle",
        radius: 88,
        thickness: 9,
        particleCount: 95,
        rx: -0.35,
        ry: 0.85,
        rz: 0.15,
        rotSpeedX: -0.3,
        rotSpeedY: -0.4,
        rotSpeedZ: 0.5,
        currentRotX: -0.2,
        currentRotY: 0.5,
        currentRotZ: 0.1,
        hueOffset: 0.33
      },
      {
        id: "outer",
        radius: 112,
        thickness: 11,
        particleCount: 110,
        rx: 0.70,
        ry: -0.50,
        rz: 0.60,
        rotSpeedX: 0.4,
        rotSpeedY: 0.3,
        rotSpeedZ: -0.4,
        currentRotX: 0.4,
        currentRotY: -0.3,
        currentRotZ: 0.2,
        hueOffset: 0.66
      }
    ];

    this.particles = [];
    this.initParticles();
  }

  initParticles() {
    this.particles = [];
    this.ringDefinitions.forEach((ring, ringIdx) => {
      for (let i = 0; i < ring.particleCount; i++) {
        const baseAngle = (i / ring.particleCount) * Math.PI * 2;
        const radiusNoise = (Math.random() - 0.5) * ring.thickness;
        const yNoise = (Math.random() - 0.5) * (ring.thickness * 0.8);
        const baseSize = Math.random() * 2.2 + 1.2;
        const sparkRate = Math.random() * 0.05 + 0.02;

        this.particles.push({
          ringIdx,
          baseAngle,
          angle: baseAngle,
          radiusNoise,
          yNoise,
          baseSize,
          sparkRate,
          sparkPhase: Math.random() * Math.PI * 2,
          colorIdx: i % 3
        });
      }
    });
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

    // Atualiza partículas
    const waveFreq = 6;
    const waveAmp = (theme.shockwaveIntensity || 0.3) * 8 + audioMetrics.mid * 12;

    this.particles.forEach((p) => {
      const ring = this.ringDefinitions[p.ringIdx];
      p.sparkPhase += p.sparkRate * (1.0 + audioMetrics.treble * 3.0);

      // Movimento angular individual ao longo do anel
      p.angle = (p.baseAngle + time * 0.15 * (p.ringIdx % 2 === 0 ? 1 : -1)) % (Math.PI * 2);

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
  }

  /**
   * Renderiza as partículas projetadas em profundidade no Canvas 2D.
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} centerX 
   * @param {number} centerY 
   * @param {object} theme 
   * @param {object} audioMetrics 
   */
  render(ctx, centerX, centerY, theme, audioMetrics) {
    // Projeta e ordena por profundidade Z para renderização volumétrica correta
    const projectedParticles = this.particles.map((p) => {
      const proj = _RaphaelMath.project3D(p.worldX, p.worldY, p.worldZ, centerX, centerY, 300);
      return {
        ...proj,
        particle: p
      };
    });

    // Z-Sorting (do mais distante para o mais próximo)
    projectedParticles.sort((a, b) => a.z - b.z);

    const palette = theme.particleColors || [
      { r: 0, g: 240, b: 255 },
      { r: 74, g: 0, b: 224 },
      { r: 0, g: 255, b: 200 }
    ];

    ctx.save();
    // Modo aditivo para brilho celestial intenso
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < projectedParticles.length; i++) {
      const item = projectedParticles[i];
      const p = item.particle;
      const color = palette[p.colorIdx % palette.length];

      const spark = 0.7 + 0.3 * Math.sin(p.sparkPhase);
      const audioGlow = 1.0 + audioMetrics.treble * 1.5;
      const finalAlpha = Math.min(1.0, item.alpha * spark * audioGlow);
      const finalSize = Math.max(0.8, p.baseSize * item.scale * (1.0 + audioMetrics.amplitude * 0.8));

      // Gradiente radial para cada partícula (efeito de pontinho estelar brilhante)
      const grad = ctx.createRadialGradient(
        item.x, item.y, 0,
        item.x, item.y, finalSize * 2.2
      );
      grad.addColorStop(0, `rgba(255, 255, 255, ${finalAlpha})`);
      grad.addColorStop(0.35, `rgba(${color.r}, ${color.g}, ${color.b}, ${finalAlpha * 0.85})`);
      grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(item.x, item.y, finalSize * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RaphaelRings };
}
