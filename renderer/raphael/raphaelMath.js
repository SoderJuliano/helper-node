/**
 * renderer/raphael/raphaelMath.js
 * Utilitários matemáticos 3D e interpolações para o motor Raphael.
 * Contém projeção em perspectiva 3D, matrizes de rotação Euler e interpolação de cores HSL/RGB.
 */

class RaphaelMath {
  /**
   * Rotaciona um ponto 3D [x, y, z] nos eixos Euler (rx, ry, rz).
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   * @param {number} rx - Rotação em radianos no eixo X
   * @param {number} ry - Rotação em radianos no eixo Y
   * @param {number} rz - Rotação em radianos no eixo Z
   * @returns {{x: number, y: number, z: number}}
   */
  static rotate3D(x, y, z, rx, ry, rz) {
    // Rotação no eixo X
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;

    // Rotação no eixo Y
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;

    // Rotação no eixo Z
    const cosZ = Math.cos(rz);
    const sinZ = Math.sin(rz);
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;

    return { x: x3, y: y3, z: z2 };
  }

  /**
   * Projeção em perspectiva de coordenadas 3D para 2D com fator de profundidade.
   * @param {number} x - Ponto X 3D
   * @param {number} y - Ponto Y 3D
   * @param {number} z - Ponto Z 3D
   * @param {number} centerX - Centro X do canvas
   * @param {number} centerY - Centro Y do canvas
   * @param {number} fov - Distância focal (padrão: 320)
   * @returns {{x: number, y: number, scale: number, alpha: number}}
   */
  static project3D(x, y, z, centerX, centerY, fov = 320) {
    const depth = fov + z;
    const scale = depth > 1 ? fov / depth : 0.001;
    const screenX = centerX + x * scale;
    const screenY = centerY + y * scale;
    
    // Alpha baseado na profundidade Z (objetos na frente mais visíveis que no fundo)
    const normalizedDepth = (z + 200) / 400;
    const alpha = Math.max(0.15, Math.min(1.0, 0.4 + normalizedDepth * 0.6));

    return { x: screenX, y: screenY, scale, alpha, z };
  }

  /**
   * Interpolação linear simples (LERP).
   */
  static lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
  }

  /**
   * Interpolação suave de cores em formato RGBA.
   */
  static lerpColor(c1, c2, amt) {
    return {
      r: Math.round(this.lerp(c1.r, c2.r, amt)),
      g: Math.round(this.lerp(c1.g, c2.g, amt)),
      b: Math.round(this.lerp(c1.b, c2.b, amt)),
      a: this.lerp(c1.a !== undefined ? c1.a : 1, c2.a !== undefined ? c2.a : 1, amt)
    };
  }

  /**
   * Converte objeto RGBA para string CSS `rgba(...)`.
   */
  static toRgbaString(c, alphaOverride = null) {
    const a = alphaOverride !== null ? alphaOverride : (c.a !== undefined ? c.a : 1.0);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, a))})`;
  }

  /**
   * Converte HSL para RGB.
   */
  static hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a: 1.0
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RaphaelMath };
}
