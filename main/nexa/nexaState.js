/**
 * main/nexa/nexaState.js
 * Gerenciador da Máquina de Estados da Nexa.
 * Estados: IDLE, LISTENING, THINKING, SPEAKING, WORKING, SEARCHING
 *
 * WORKING é especificamente "mexendo em arquivos" (ler/escrever/editar).
 * SEARCHING é busca/pesquisa ativa na internet ou acesso a páginas web externas (globo holográfico).
 * Raciocinar é THINKING e responder é SPEAKING.
 */

const { EventEmitter } = require("events");

const VALID_STATES = new Set(["IDLE", "LISTENING", "THINKING", "SPEAKING", "WORKING", "SEARCHING"]);

class NexaStateMachine extends EventEmitter {
  constructor() {
    super();
    this.currentState = "IDLE";
  }

  getState() {
    return this.currentState;
  }

  setState(newState) {
    if (!VALID_STATES.has(newState)) {
      console.warn(`[NexaState] Estado inválido ignorado: ${newState}`);
      return false;
    }

    if (this.currentState === newState) {
      return false;
    }

    const previousState = this.currentState;
    this.currentState = newState;
    console.log(`[NexaState] Transição: ${previousState} -> ${newState}`);

    this.emit("state-changed", {
      state: this.currentState,
      previousState: previousState,
      timestamp: Date.now()
    });

    return true;
  }

  reset() {
    return this.setState("IDLE");
  }
}

const nexaState = new NexaStateMachine();

module.exports = {
  nexaState,
  VALID_STATES
};
