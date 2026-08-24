/**
 * main/nexa/nexaAnimations.js
 * Catálogo central de animações disponíveis para a Nexa.
 * Todas as animações foram migradas de MP4 para Lottie para economizar recursos e otimizar a performance.
 * Os caminhos agora são dinâmicos e resolvidos em relação ao diretório de instalação do app.
 */

const path = require("path");

const NEXA_ANIMATIONS = {
  wave: {
    name: "wave",
    description: "Nexa entra fazendo um aceno amigável com a mão.",
    category: "greeting",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/wave_lottie/animations/main.json")
  },
  idle_boring: {
    name: "idle_boring",
    description: "Nexa faz movimentos lentos demonstrando tédio ou bocejo.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/idle_lottie/animations/main.json")
  },
  adjust_glasses: {
    name: "adjust_glasses",
    description: "Nexa ajusta os óculos com a mão.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/adjust_glasses_lottie/animations/main.json")
  },
  stretching_arms: {
    name: "stretching_arms",
    description: "Nexa ergue os braços e se estica/espreguiça.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/stretching_lottie/animations/main.json")
  },
  squatting_doodling: {
    name: "squatting_doodling",
    description: "Nexa agacha e fica desenhando/rabiscando no chão.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/squatting_lottie/animations/main.json")
  },
  sleeping: {
    name: "sleeping",
    description: "Nexa deita de lado e dorme profundamente.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/sleeping_lottie/animations/main.json")
  },
  floating: {
    name: "floating",
    description: "Nexa flutua suavemente no ar.",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/floating_lottie/animations/main.json")
  },
  landing: {
    name: "landing",
    description: "Nexa desce flutuando e pousa de pé de forma graciosa.",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/landing_lottie/animations/main.json")
  },
  heart: {
    name: "heart",
    description: "Nexa faz um coração com as mãos para expressar carinho ou quando gosta de algo.",
    category: "affection",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/heart_lottie/animations/main.json")
  },
  cute: {
    name: "cute",
    description: "Nexa leva as mãos ao rosto demonstrando timidez, afeto e gratidão (cute cute).",
    category: "affection",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/cute_lottie/animations/main.json")
  },
  listening: {
    name: "listening",
    description: "Nexa entra em pose de escuta atenta.",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/listening_lottie/animations/main.json")
  },
  thinking: {
    name: "thinking",
    description: "Nexa fica pensativa com o dedinho no queixo em pose de reflexão (estilo pensando/loading).",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/thinking_lottie/animations/main.json")
  },
  speaking: {
    name: "speaking",
    description: "Nexa fala em loop, sem sincronia labial real com o áudio (apenas para dar a impressão de fala).",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/speaking_lottie/animations/main.json")
  },
  typing: {
    name: "typing",
    description: "Nexa digita em um teclado digital / terminal holográfico (usada durante leitura, escrita ou edição de arquivos/código).",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/typing_lottie/animations/main.json")
  },
  writing_code: {
    name: "writing_code",
    description: "Nexa escreve código concentrada em seu terminal.",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/writing_code_lottie/animations/main.json")
  },
  coffee: {
    name: "coffee",
    description: "Nexa segura uma xícara de café e relaxa/aproveita a bebida.",
    category: "idle",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/coffee_lottie/animations/main.json")
  },
  dance: {
    name: "dance",
    description: "Nexa faz uma dança/dancinha comemorativa de 8 segundos (usada exclusivamente quando o usuário pedir para ela dançar ou comemorar algo).",
    category: "action",
    lottiePath: path.join(__dirname, "../../renderer/nexa/assets/lottie/dance_lottie/animations/main.json")
  }
};

module.exports = {
  NEXA_ANIMATIONS
};
