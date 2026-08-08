/**
 * main/nexa/nexaMemory.js
 * Gerenciador de Memória Persistente Exclusiva da Nexa.
 * Armazena informações da relação entre Usuário <-> Nexa em <userData>/nexa/memory.json.
 */

const { app } = require("electron");
const path = require("path");
const fs = require("fs");

function getMemoryPath() {
  const userDataPath = app.getPath("userData");
  const nexaDir = path.join(userDataPath, "nexa");
  if (!fs.existsSync(nexaDir)) {
    fs.mkdirSync(nexaDir, { recursive: true });
  }
  return path.join(nexaDir, "memory.json");
}

function loadMemory() {
  const filePath = getMemoryPath();
  if (!fs.existsSync(filePath)) {
    return { facts: [] };
  }
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed || !Array.isArray(parsed.facts)) {
      return { facts: [] };
    }
    return parsed;
  } catch (err) {
    console.error("[NexaMemory] Erro ao carregar memória:", err.message);
    return { facts: [] };
  }
}

function saveMemory(memory) {
  const filePath = getMemoryPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error("[NexaMemory] Erro ao salvar memória:", err.message);
  }
}

function addMemoryFact(fact) {
  if (!fact || typeof fact !== "string" || fact.trim() === "") return;
  const memory = loadMemory();
  
  // Evita duplicatas simples
  const cleanFact = fact.trim();
  if (memory.facts.includes(cleanFact)) return;

  console.log("[NexaMemory] Novo fato adicionado à memória:", cleanFact);
  memory.facts.push(cleanFact);
  
  // Limita a memória a no máximo 100 fatos relevantes para não estourar contexto
  if (memory.facts.length > 100) {
    memory.facts.shift();
  }
  
  saveMemory(memory);
}

function getMemoryForPrompt() {
  const memory = loadMemory();
  if (memory.facts.length === 0) {
    return "Nenhuma memória registrada ainda sobre o relacionamento com o usuário.";
  }
  return memory.facts.map((fact, index) => `${index + 1}. ${fact}`).join("\n");
}

module.exports = {
  loadMemory,
  saveMemory,
  addMemoryFact,
  getMemoryForPrompt
};
