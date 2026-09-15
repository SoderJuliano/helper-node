/**
 * renderer/raphael/raphaelThemes.js
 * Configurações de paleta de cores, dinâmica de rotação e física para cada estado do Raphael Core.
 */

const RAPHAEL_THEMES = {
  IDLE: {
    name: "IDLE",
    description: "Vigilância & Standby - Pulsação cósmica suave e anéis serenos",
    coreColorPrimary: { r: 0, g: 240, b: 255, a: 0.95 },     // Ciano Etéreo
    coreColorSecondary: { r: 74, g: 0, b: 224, a: 0.70 },   // Índigo Cósmico
    coronaColor: { r: 140, g: 82, b: 255, a: 0.40 },        // Violeta Suave
    particleColors: [
      { r: 0, g: 240, b: 255 },
      { r: 74, g: 0, b: 224 },
      { r: 0, g: 255, b: 200 }
    ],
    ringRotationSpeed: 0.8,
    pulseSpeed: 1.5,
    coreRadius: 36,
    particleCount: 160,
    shockwaveIntensity: 0.2
  },

  LISTENING: {
    name: "LISTENING",
    description: "Captação Acústica / Escuta - Anéis convergem e brilho solar foca na voz",
    coreColorPrimary: { r: 255, g: 190, b: 0, a: 1.0 },     // Âmbar Solar
    coreColorSecondary: { r: 255, g: 100, b: 0, a: 0.80 },   // Laranja Radiante
    coronaColor: { r: 255, g: 240, b: 150, a: 0.50 },       // Dourado Brilhante
    particleColors: [
      { r: 255, g: 215, b: 0 },
      { r: 255, g: 140, b: 0 },
      { r: 255, g: 255, b: 200 }
    ],
    ringRotationSpeed: 1.4,
    pulseSpeed: 3.0,
    coreRadius: 40,
    particleCount: 180,
    shockwaveIntensity: 0.4
  },

  THINKING: {
    name: "THINKING",
    description: "Processamento Quântico - Rotação giroscópica acelerada nos eixos X/Y/Z e plasma vibrante",
    coreColorPrimary: { r: 168, g: 45, b: 255, a: 1.0 },    // Violeta Quântico
    coreColorSecondary: { r: 255, g: 0, b: 128, a: 0.85 },   // Magenta Nebulosa
    coronaColor: { r: 120, g: 100, b: 255, a: 0.55 },       // Azul Quântico
    particleColors: [
      { r: 190, g: 70, b: 255 },
      { r: 255, g: 20, b: 147 },
      { r: 100, g: 220, b: 255 }
    ],
    ringRotationSpeed: 2.8,
    pulseSpeed: 4.5,
    coreRadius: 42,
    particleCount: 220,
    shockwaveIntensity: 0.7
  },

  SPEAKING: {
    name: "SPEAKING",
    description: "Ressonância Vocal - Núcleo vibra e emite ondas de energia sincronizadas com a fala",
    coreColorPrimary: { r: 0, g: 229, b: 255, a: 1.0 },     // Luminescent Cyan
    coreColorSecondary: { r: 0, g: 119, b: 254, a: 0.85 },   // Azul Elétrico
    coronaColor: { r: 200, g: 255, b: 255, a: 0.60 },       // Branco Opalino
    particleColors: [
      { r: 0, g: 255, b: 255 },
      { r: 50, g: 160, b: 255 },
      { r: 255, g: 255, b: 255 }
    ],
    ringRotationSpeed: 2.0,
    pulseSpeed: 5.0,
    coreRadius: 45,
    particleCount: 240,
    shockwaveIntensity: 0.9
  },

  WORKING: {
    name: "WORKING",
    description: "Manipulação de Arquivos e Código - Feixes binários esmeralda e cálculo contínuo",
    coreColorPrimary: { r: 0, g: 255, b: 136, a: 1.0 },     // Matrix Emerald
    coreColorSecondary: { r: 5, g: 255, b: 161, a: 0.80 },   // Verde Cibernético
    coronaColor: { r: 180, g: 255, b: 200, a: 0.50 },       // Verde Menta Claro
    particleColors: [
      { r: 0, g: 255, b: 136 },
      { r: 0, g: 200, b: 80 },
      { r: 220, g: 255, b: 230 }
    ],
    ringRotationSpeed: 2.2,
    pulseSpeed: 3.5,
    coreRadius: 38,
    particleCount: 200,
    shockwaveIntensity: 0.6
  },

  SEARCHING: {
    name: "SEARCHING",
    description: "Acesso à Rede / Pesquisa Web - Auréolas expandidas formando malha de rede global",
    coreColorPrimary: { r: 0, g: 120, b: 255, a: 1.0 },     // Azul Safira
    coreColorSecondary: { r: 0, g: 200, b: 255, a: 0.85 },   // Azul Oceânico
    coronaColor: { r: 100, g: 210, b: 255, a: 0.50 },       // Ciano Celeste
    particleColors: [
      { r: 0, g: 140, b: 255 },
      { r: 0, g: 230, b: 255 },
      { r: 180, g: 240, b: 255 }
    ],
    ringRotationSpeed: 2.0,
    pulseSpeed: 3.0,
    coreRadius: 40,
    particleCount: 210,
    shockwaveIntensity: 0.5
  },

  SLEEPING: {
    name: "SLEEPING",
    description: "Hibernação / AFK - Baixo consumo, pulsação relaxante de estrela adormecida",
    coreColorPrimary: { r: 35, g: 45, b: 75, a: 0.65 },     // Azul Meia-Noite
    coreColorSecondary: { r: 20, g: 25, b: 45, a: 0.50 },   // Trevas Estelares
    coronaColor: { r: 60, g: 80, b: 120, a: 0.25 },         // Brilho Fraco
    particleColors: [
      { r: 60, g: 80, b: 120 },
      { r: 40, g: 60, b: 90 },
      { r: 100, g: 130, b: 180 }
    ],
    ringRotationSpeed: 0.3,
    pulseSpeed: 0.6,
    coreRadius: 28,
    particleCount: 80,
    shockwaveIntensity: 0.05
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RAPHAEL_THEMES };
}
