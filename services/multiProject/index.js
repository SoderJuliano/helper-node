// services/multiProject/index.js
// Fachada do módulo Multi-Project (Gerenciamento de múltiplos projetos e execução concorrente).

const MultiProjectService = require('./multiProjectService');
const MultiRunnerService = require('./multiRunnerService');

const multiRunner = new MultiRunnerService();

module.exports = {
  MultiProjectService,
  MultiRunnerService,
  multiRunner,
};
