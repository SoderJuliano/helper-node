/**
 * main/nexa/nexaAnimations.js
 * Catálogo central de animações disponíveis para a Nexa.
 */

const NEXA_ANIMATIONS = {
  wave: {
    name: "wave",
    description: "Nexa entra fazendo um aceno amigável com a mão.",
    category: "greeting",
    videoPath: "/home/soder/Documents/nexa-workspace/animacoes_google_flow/White-haired_girl_waving_202608051124.mp4"
  },
  idle_boring: {
    name: "idle_boring",
    description: "Nexa faz movimentos lentos demonstrando tédio ou bocejo.",
    category: "idle",
    videoPath: "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Animated_anime_girl_idling_202608051517.mp4"
  },
  floating: {
    name: "floating",
    description: "Nexa flutua suavemente no ar.",
    category: "action",
    videoPath: "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_floating_in_air_202608051113.mp4"
  },
  landing: {
    name: "landing",
    description: "Nexa desce flutuando e pousa de pé de forma graciosa.",
    category: "action",
    videoPath: "/home/soder/Documents/nexa-workspace/animacoes_google_flow/Anime_girl_lands_on_feet_202608051122.mp4"
  },
  heart: {
    name: "heart",
    description: "Nexa expressa carinho e gratidão inclinando a cabeça, sorrindo e piscando.",
    category: "affection",
    procedural: true
  }
};

module.exports = {
  NEXA_ANIMATIONS
};
