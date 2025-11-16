const express = require('express');

const app = express();
const port = 3000; // Porta para o servidor IPC

let toggleRecordingCallback = null;

/**
 * Inicia o servidor IPC.
 * @param {Function} toggleRecordingFunc - A função a ser chamada para alternar a gravação.
 */
function start(toggleRecordingFunc) {
  if (typeof toggleRecordingFunc !== 'function') {
    console.error('ipcService: A função toggleRecording não foi fornecida.');
    return;
  }

  toggleRecordingCallback = toggleRecordingFunc;

  app.post('/toggle-recording', (req, res) => {
    if (toggleRecordingCallback) {
      try {
        toggleRecordingCallback();
        res.status(200).send({ message: 'Ação de gravação alternada com sucesso.' });
      } catch (error) {
        console.error('Erro ao alternar a gravação via IPC:', error);
        res.status(500).send({ message: 'Erro interno ao processar a ação.' });
      }
    } else {
      console.error('Callback de gravação não configurado no servidor IPC.');
      res.status(500).send({ message: 'Servidor não configurado corretamente.' });
    }
  });

  app.listen(port, () => {
    console.log(`Servidor IPC ouvindo em http://localhost:${port}`);
  });
}

module.exports = {
  start,
};
