/**
 * main/nexa/nexaAnimations.js
 * Catálogo central de animações disponíveis para a Nexa.
 * Todas as animações foram migradas de MP4 para Lottie para economizar recursos e otimizar a performance.
 */

const NEXA_ANIMATIONS = {
  wave: {
    name: "wave",
    description: "Nexa entra fazendo um aceno amigável com a mão.",
    category: "greeting",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/wave_lottie/animations/main.json"
  },
  idle_boring: {
    name: "idle_boring",
    description: "Nexa faz movimentos lentos demonstrando tédio ou bocejo.",
    category: "idle",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/idle_lottie/animations/main.json"
  },
  adjust_glasses: {
    name: "adjust_glasses",
    description: "Nexa ajusta os óculos com a mão.",
    category: "idle",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/adjust_glasses_lottie/animations/main.json"
  },
  stretching_arms: {
    name: "stretching_arms",
    description: "Nexa ergue os braços e se estica/espreguiça.",
    category: "idle",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/stretching_lottie/animations/main.json"
  },
  squatting_doodling: {
    name: "squatting_doodling",
    description: "Nexa agacha e fica desenhando/rabiscando no chão.",
    category: "idle",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/squatting_lottie/animations/main.json"
  },
  sleeping: {
    name: "sleeping",
    description: "Nexa deita de lado e dorme profundamente.",
    category: "idle",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/sleeping_lottie/animations/main.json"
  },
  floating: {
    name: "floating",
    description: "Nexa flutua suavemente no ar.",
    category: "action",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/floating_lottie/animations/main.json"
  },
  landing: {
    name: "landing",
    description: "Nexa desce flutuando e pousa de pé de forma graciosa.",
    category: "action",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/landing_lottie/animations/main.json"
  },
  heart: {
    name: "heart",
    description: "Nexa faz um coração com as mãos para expressar carinho ou quando gosta de algo.",
    category: "affection",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/heart_lottie/animations/main.json"
  },
  cute: {
    name: "cute",
    description: "Nexa leva as mãos ao rosto demonstrando timidez, afeto e gratidão (cute cute).",
    category: "affection",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/cute_lottie/animations/main.json"
  },
  listening: {
    name: "listening",
    description: "Nexa entra em pose de escuta atenta.",
    category: "action",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/listening_lottie/animations/main.json"
  },
  thinking: {
    name: "thinking",
    description: "Nexa fica pensativa em pose de reflexão (estilo pensando/loading).",
    category: "action",
    lottiePath: "/home/soder/Documents/nexa-workspace/lottie/thinking_lottie/animations/main.json"
  }
};

module.exports = {
  NEXA_ANIMATIONS
};
