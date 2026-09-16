/**
 * renderer/raphael/raphaelThemes.js
 * Configurações de paleta de cores, dinâmica de rotação e física para cada estado do Raphael Core.
 */

(function(root) {
  const RAPHAEL_THEMES = {
    IDLE: {
      name: "IDLE",
      description: "Vigilância & Standby - Pulsação cósmica suave e anéis serenos",
      coreColorPrimary: { r: 0, g: 240, b: 255, a: 0.95 },     // Ciano Etéreo
      coreColorSecondary: { r: 74, g: 0, b: 224, a: 0.85 },   // Índigo Cósmico
      coronaColor: { r: 140, g: 82, b: 255, a: 0.45 },        // Violeta Suave
      nebulaDark: { r: 8, g: 12, b: 35, a: 0.92 },            // Sombra Cósmica da Esfera
      rimColor: { r: 0, g: 255, b: 255, a: 1.0 },             // Borda Fresnel Neon Ciano
      specularColor: { r: 255, g: 255, b: 255, a: 0.90 },     // Brilho Especular 3D
      innerGlowColor: { r: 200, g: 255, b: 255, a: 1.0 },     // Núcleo Quente
      particleColors: [
        { r: 0, g: 240, b: 255 },
        { r: 74, g: 0, b: 224 },
        { r: 0, g: 255, b: 200 },
        { r: 180, g: 100, b: 255 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 0.85,
      pulseSpeed: 1.6,
      coreRadius: 34,
      particleCount: 220,
      shockwaveIntensity: 0.25
    },

    LISTENING: {
      name: "LISTENING",
      description: "Captação Acústica / Escuta - Anéis convergem e brilho solar foca na voz",
      coreColorPrimary: { r: 255, g: 190, b: 0, a: 1.0 },     // Âmbar Solar
      coreColorSecondary: { r: 255, g: 90, b: 0, a: 0.90 },    // Laranja Radiante
      coronaColor: { r: 255, g: 235, b: 120, a: 0.55 },       // Dourado Brilhante
      nebulaDark: { r: 35, g: 15, b: 5, a: 0.94 },            // Sombra Âmbar Profunda
      rimColor: { r: 255, g: 220, b: 50, a: 1.0 },            // Borda Fresnel Dourada
      specularColor: { r: 255, g: 255, b: 240, a: 0.95 },     // Brilho Especular Solar
      innerGlowColor: { r: 255, g: 255, b: 200, a: 1.0 },     // Núcleo Solar
      particleColors: [
        { r: 255, g: 215, b: 0 },
        { r: 255, g: 140, b: 0 },
        { r: 255, g: 90, b: 0 },
        { r: 255, g: 245, b: 160 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 1.5,
      pulseSpeed: 3.2,
      coreRadius: 35,
      particleCount: 240,
      shockwaveIntensity: 0.45
    },

    THINKING: {
      name: "THINKING",
      description: "Processamento Quântico - Rotação giroscópica acelerada nos eixos X/Y/Z e plasma vibrante",
      coreColorPrimary: { r: 185, g: 30, b: 255, a: 1.0 },    // Violeta Quântico
      coreColorSecondary: { r: 255, g: 0, b: 140, a: 0.90 },   // Magenta / Hot Pink
      coronaColor: { r: 130, g: 90, b: 255, a: 0.60 },        // Azul/Violeta Nebulosa
      nebulaDark: { r: 22, g: 5, b: 36, a: 0.95 },            // Sombra Quântica Cósmica
      rimColor: { r: 255, g: 40, b: 200, a: 1.0 },            // Borda Fresnel Neon Magenta
      specularColor: { r: 255, g: 230, b: 255, a: 0.95 },     // Brilho Especular
      innerGlowColor: { r: 255, g: 200, b: 255, a: 1.0 },     // Núcleo Quântico
      particleColors: [
        { r: 210, g: 60, b: 255 },
        { r: 255, g: 20, b: 150 },
        { r: 0, g: 225, b: 255 },
        { r: 120, g: 240, b: 200 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 3.0,
      pulseSpeed: 4.8,
      coreRadius: 36,
      particleCount: 280,
      shockwaveIntensity: 0.75
    },

    SPEAKING: {
      name: "SPEAKING",
      description: "Ressonância Vocal - Núcleo vibra e emite ondas de energia sincronizadas com a fala",
      coreColorPrimary: { r: 0, g: 235, b: 255, a: 1.0 },     // Luminescent Cyan
      coreColorSecondary: { r: 0, g: 110, b: 255, a: 0.90 },   // Azul Elétrico
      coronaColor: { r: 190, g: 255, b: 255, a: 0.65 },       // Branco Opalino / Celeste
      nebulaDark: { r: 5, g: 15, b: 40, a: 0.94 },            // Sombra Azul Profunda
      rimColor: { r: 0, g: 255, b: 255, a: 1.0 },             // Borda Fresnel Neon Ciano
      specularColor: { r: 255, g: 255, b: 255, a: 0.95 },     // Brilho Especular
      innerGlowColor: { r: 220, g: 255, b: 255, a: 1.0 },     // Núcleo Radiante
      particleColors: [
        { r: 0, g: 255, b: 255 },
        { r: 40, g: 160, b: 255 },
        { r: 0, g: 255, b: 180 },
        { r: 200, g: 245, b: 255 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 2.2,
      pulseSpeed: 5.2,
      coreRadius: 38,
      particleCount: 290,
      shockwaveIntensity: 0.95
    },

    WORKING: {
      name: "WORKING",
      description: "Manipulação de Arquivos e Código - Feixes binários esmeralda e cálculo contínuo",
      coreColorPrimary: { r: 0, g: 255, b: 136, a: 1.0 },     // Matrix Emerald
      coreColorSecondary: { r: 5, g: 200, b: 140, a: 0.85 },   // Verde Cibernético
      coronaColor: { r: 170, g: 255, b: 200, a: 0.55 },       // Verde Menta Claro
      nebulaDark: { r: 4, g: 30, b: 18, a: 0.94 },            // Sombra Matrix
      rimColor: { r: 50, g: 255, b: 160, a: 1.0 },            // Borda Fresnel Esmeralda
      specularColor: { r: 230, g: 255, b: 240, a: 0.95 },     // Brilho Especular
      innerGlowColor: { r: 210, g: 255, b: 230, a: 1.0 },     // Núcleo Esmeralda
      particleColors: [
        { r: 0, g: 255, b: 136 },
        { r: 0, g: 210, b: 90 },
        { r: 100, g: 255, b: 210 },
        { r: 200, g: 255, b: 230 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 2.4,
      pulseSpeed: 3.8,
      coreRadius: 34,
      particleCount: 250,
      shockwaveIntensity: 0.65
    },

    SEARCHING: {
      name: "SEARCHING",
      description: "Acesso à Rede / Pesquisa Web - Auréolas expandidas formando malha de rede global",
      coreColorPrimary: { r: 0, g: 130, b: 255, a: 1.0 },     // Azul Safira
      coreColorSecondary: { r: 0, g: 210, b: 255, a: 0.88 },   // Azul Oceânico
      coronaColor: { r: 90, g: 215, b: 255, a: 0.55 },        // Ciano Celeste
      nebulaDark: { r: 5, g: 18, b: 45, a: 0.95 },            // Sombra Oceânica
      rimColor: { r: 30, g: 180, b: 255, a: 1.0 },            // Borda Fresnel Safira
      specularColor: { r: 230, g: 250, b: 255, a: 0.95 },     // Brilho Especular
      innerGlowColor: { r: 190, g: 240, b: 255, a: 1.0 },     // Núcleo Safira
      particleColors: [
        { r: 0, g: 140, b: 255 },
        { r: 0, g: 230, b: 255 },
        { r: 80, g: 255, b: 240 },
        { r: 180, g: 240, b: 255 },
        { r: 255, g: 255, b: 255 }
      ],
      ringRotationSpeed: 2.1,
      pulseSpeed: 3.2,
      coreRadius: 35,
      particleCount: 260,
      shockwaveIntensity: 0.55
    },

    SLEEPING: {
      name: "SLEEPING",
      description: "Hibernação / AFK - Baixo consumo, pulsação relaxante de estrela adormecida",
      coreColorPrimary: { r: 40, g: 50, b: 85, a: 0.70 },     // Azul Meia-Noite
      coreColorSecondary: { r: 22, g: 28, b: 50, a: 0.55 },   // Trevas Estelares
      coronaColor: { r: 65, g: 85, b: 130, a: 0.30 },         // Brilho Fraco
      nebulaDark: { r: 10, g: 12, b: 22, a: 0.90 },           // Sombra Meia-Noite
      rimColor: { r: 70, g: 100, b: 160, a: 0.8 },            // Borda Fresnel Suave
      specularColor: { r: 150, g: 180, b: 230, a: 0.50 },     // Brilho Fraco
      innerGlowColor: { r: 100, g: 130, b: 190, a: 0.6 },     // Núcleo Adormecido
      particleColors: [
        { r: 60, g: 80, b: 120 },
        { r: 40, g: 60, b: 90 },
        { r: 100, g: 130, b: 180 }
      ],
      ringRotationSpeed: 0.35,
      pulseSpeed: 0.7,
      coreRadius: 25,
      particleCount: 90,
      shockwaveIntensity: 0.08
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { RAPHAEL_THEMES };
  }
  if (root) {
    root.RAPHAEL_THEMES = RAPHAEL_THEMES;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
