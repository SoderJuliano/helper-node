// services/config/translationConfigAccessors.js
const { defaultConfig } = require('./defaultConfig.js');

function createTranslationAccessors(ctx) {
  function get() {
    return ctx.getCurrentConfig();
  }
  function save() {
    ctx.persistCurrentConfig();
  }

  return {
    getTranslationAssistantConfig() {
      const cfg = get();
      return { ...defaultConfig.translationAssistant, ...(cfg.translationAssistant || {}) };
    },

    setTranslationAssistantConfig(partial) {
      const cfg = get();
      cfg.translationAssistant = {
        ...(cfg.translationAssistant || defaultConfig.translationAssistant),
        ...partial,
      };
      save();
    },

    getUserContextBlock() {
      const ta = this.getTranslationAssistantConfig();
      const name = (ta.userName || '').trim();
      const bg = (ta.userBackground || '').trim();
      const tech = (ta.userTechExperiences || '').trim();
      const beh = (ta.userBehavioral || '').trim();
      if (!name && !bg && !tech && !beh) return '';
      const lines = ['[CONTEXTO DO USUÁRIO — use para personalizar a resposta/sugestão]'];
      if (name) lines.push(`Nome: ${name}`);
      if (bg) lines.push(`Perfil Profissional & Currículo (CV / Resumo Geral):\n${bg}`);
      if (tech) lines.push(`Experiências Técnicas & Projetos Detalhados (Hard Skills):\n${tech}`);
      if (beh) lines.push(`Histórias Comportamentais & Soft Skills (STAR / Situações):\n${beh}`);
      return lines.join('\n\n');
    },
  };
}

module.exports = {
  createTranslationAccessors,
};
