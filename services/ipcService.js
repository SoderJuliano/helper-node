const express = require('express');

const app = express();
const port = 3000;

let callbacks = {};

/**
 * Inicia o servidor IPC.
 * @param {object} funcs - Um objeto contendo as funções de callback.
 * @param {Function} funcs.toggleRecording - A função para alternar a gravação.
 * @param {Function} funcs.moveToDisplay - A função para mover a janela para um display específico.
 * @param {Function} funcs.bringWindowToFocus - A função para trazer a janela para o foco e abrir o input.
 * @param {Function} funcs.captureScreen - A função para capturar a tela.
 */
function start(funcs) {
  if (!funcs || typeof funcs.toggleRecording !== 'function' || typeof funcs.moveToDisplay !== 'function' || typeof funcs.bringWindowToFocus !== 'function' || typeof funcs.captureScreen !== 'function') {
    console.error('ipcService: As funções de callback necessárias não foram fornecidas.');
    return;
  }

  callbacks = funcs;

  app.post('/toggle-recording', (req, res) => {
    if (callbacks.toggleRecording) {
      try {
        callbacks.toggleRecording();
        res.status(200).send({ message: 'Ação de gravação alternada com sucesso.' });
      } catch (error) {
        console.error('Erro ao alternar a gravação via IPC:', error);
        res.status(500).send({ message: 'Erro interno ao processar a ação.' });
      }
    } else {
      res.status(500).send({ message: 'Callback de gravação não configurado.' });
    }
  });

  app.post('/capture-screen', (req, res) => {
    if (callbacks.captureScreen) {
      try {
        callbacks.captureScreen();
        res.status(200).send({ message: 'Ação de captura de tela executada com sucesso.' });
      } catch (error) {
        console.error('Erro ao capturar a tela via IPC:', error);
        res.status(500).send({ message: 'Erro interno ao processar a ação.' });
      }
    } else {
      res.status(500).send({ message: 'Callback de captura de tela não configurado.' });
    }
  });

  app.post('/move-to-display/:displayId', (req, res) => {
    if (callbacks.moveToDisplay) {
      try {
        const displayId = parseInt(req.params.displayId, 10);
        if (isNaN(displayId)) {
          return res.status(400).send({ message: 'ID do display inválido.' });
        }
        callbacks.moveToDisplay(displayId);
        res.status(200).send({ message: `Janela movida para o display ${displayId}.` });
      } catch (error) {
        console.error('Erro ao mover a janela via IPC:', error);
        res.status(500).send({ message: 'Erro interno ao mover a janela.' });
      }
    } else {
      res.status(500).send({ message: 'Callback de mover a janela não configurado.' });
    }
  });

  app.post('/bring-to-focus-and-input', (req, res) => {
    if (callbacks.bringWindowToFocus) {
      try {
        callbacks.bringWindowToFocus();
        res.status(200).send({ message: 'Janela trazida para o foco e input aberto.' });
      } catch (error) {
        console.error('Erro ao trazer janela para o foco e abrir input via IPC:', error);
        res.status(500).send({ message: 'Erro interno ao processar a ação.' });
      }
    } else {
      res.status(500).send({ message: 'Callback de trazer janela para o foco e abrir input não configurado.' });
    }
  });

  app.listen(port, () => {
    console.log(`Servidor IPC ouvindo em http://localhost:${port}`);
  });
}

module.exports = {
  start,
};
