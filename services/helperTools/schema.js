// services/helperTools/schema.js
// Gera o array de tools no formato esperado pelo OpenAI Chat Completions
// (function calling). Cada tool registrada precisa expor um schema JSON-Schema.

const registry = require("./registry");

function toOpenAITools() {
  return registry.list().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.schema || { type: "object", properties: {} },
    },
  }));
}

// Para backends sem tool-calling nativo (Ollama via /llama3 etc), gera
// uma descrição em texto pra inserir no system prompt.
function toTextDescription() {
  return registry
    .list()
    .map((t) => {
      const params = JSON.stringify((t.schema && t.schema.properties) || {});
      return `- ${t.name}(${params}): ${t.description || ""}${
        t.mutates ? " [MUTATES — requer confirmação]" : ""
      }`;
    })
    .join("\n");
}

module.exports = { toOpenAITools, toTextDescription };
