// Edição do app: 'lite' (100% online — só modelos cloud) ou 'full' (offline,
// com Whisper/Vosk/Ollama locais). O build (package.sh) grava `edition.json` na
// raiz do app com { "edition": "lite" }. Rodando do código-fonte (npm start) o
// arquivo não existe → assume 'full', então o ambiente de dev mantém TODAS as
// features. Nada de lógica nova é destrutiva: a Lite só ESCONDE/desvia caminhos.
const fs = require('fs');
const path = require('path');

let _edition = null;

function getEdition() {
  if (_edition) return _edition;
  try {
    const p = path.join(__dirname, '..', 'edition.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    _edition = raw && raw.edition === 'lite' ? 'lite' : 'full';
  } catch (_) {
    _edition = 'full';
  }
  return _edition;
}

function isLite() {
  return getEdition() === 'lite';
}

module.exports = { getEdition, isLite };
