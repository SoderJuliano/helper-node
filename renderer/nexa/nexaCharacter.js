/**
 * renderer/nexa/nexaCharacter.js
 * Gerenciador de composição e renderização 2D de camadas PNG da Nexa.
 * Suporta pivôs individuais de rotação/escala para cada nó (cabeça, boca, olhos, torso).
 */

class CharacterLayer {
  constructor(name, filename, options = {}) {
    this.name = name;
    this.filename = filename;
    this.image = null;
    this.isLoaded = false;

    this.x = options.x || 0;
    this.y = options.y || 0;
    this.scaleX = options.scaleX !== undefined ? options.scaleX : 1.0;
    this.scaleY = options.scaleY !== undefined ? options.scaleY : 1.0;
    this.rotation = options.rotation || 0; // em radianos
    this.opacity = options.opacity !== undefined ? options.opacity : 1.0;
    this.visible = options.visible !== undefined ? options.visible : true;

    // Pivô de rotação e escala em coordenadas nativas da imagem (1280x1280)
    this.pivotX = options.pivotX !== undefined ? options.pivotX : 640;
    this.pivotY = options.pivotY !== undefined ? options.pivotY : 640;
  }

  load(basePath) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.isLoaded = true;
        resolve(true);
      };
      img.onerror = () => {
        console.warn(`[NexaCharacter] Falha ao carregar camada: ${this.name} (${this.filename})`);
        resolve(false);
      };
      // Garante suporte a URI local ou caminho relativo
      const srcPath = basePath.endsWith("/") ? basePath + this.filename : `${basePath}/${this.filename}`;
      img.src = srcPath.startsWith("file://") || srcPath.startsWith("http") ? srcPath : `file://${srcPath}`;
    });
  }

  draw(ctx, parentTransform = {}) {
    if (!this.visible || !this.isLoaded || !this.image || this.opacity <= 0) return;

    const pX = parentTransform.x || 0;
    const pY = parentTransform.y || 0;
    const pScaleX = parentTransform.scaleX !== undefined ? parentTransform.scaleX : 1.0;
    const pScaleY = parentTransform.scaleY !== undefined ? parentTransform.scaleY : 1.0;
    const pRot = parentTransform.rotation || 0;
    const pPivotX = parentTransform.pivotX !== undefined ? parentTransform.pivotX : 640;
    const pPivotY = parentTransform.pivotY !== undefined ? parentTransform.pivotY : 640;

    ctx.save();
    ctx.globalAlpha *= this.opacity;

    // Aplica transformação do Nó Pai (ex: Cabeça ou Torso)
    if (pX !== 0 || pY !== 0 || pRot !== 0 || pScaleX !== 1.0 || pScaleY !== 1.0) {
      ctx.translate(pPivotX + pX, pPivotY + pY);
      ctx.rotate(pRot);
      ctx.scale(pScaleX, pScaleY);
      ctx.translate(-pPivotX, -pPivotY);
    }

    // Aplica transformação da Camada Local (ex: Escala da Boca ou Piscar de Olho)
    const totalX = this.x;
    const totalY = this.y;
    const totalPivotX = this.pivotX;
    const totalPivotY = this.pivotY;

    ctx.translate(totalPivotX + totalX, totalPivotY + totalY);
    ctx.rotate(this.rotation);
    ctx.scale(this.scaleX, this.scaleY);
    ctx.translate(-totalPivotX, -totalPivotY);

    ctx.drawImage(this.image, 0, 0);
    ctx.restore();
  }
}

class NexaCharacter {
  constructor() {
    this.layers = [];
    this.layerMap = {};
    this.isFullyLoaded = false;

    // Transformações dos nós principais (usadas pelos controladores procedurais)
    this.nodes = {
      body: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: 644.5, pivotY: 398.0 },
      head: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: 645.5, pivotY: 220.0 },
      eyes: { offsetX: 0, offsetY: 0, scaleY: 1 },
      mouth: { scaleY: 1.0, scaleX: 1.0, offsetY: 0, pivotX: 642.5, pivotY: 221.0 }
    };

    this.initLayers();
  }

  initLayers() {
    // Ordem estrita de composição (Camada traseira -> frontal)
    const layerDefs = [
      { name: "back_hair", file: "back hair.png", group: "body", pivotX: 644.0, pivotY: 154.5 },
      { name: "legwear", file: "legwear.png", group: "body", pivotX: 640.0, pivotY: 800.0 },
      { name: "footwear", file: "footwear.png", group: "body", pivotX: 640.0, pivotY: 1100.0 },
      { name: "bottomwear", file: "bottomwear.png", group: "body", pivotX: 640.0, pivotY: 600.0 },
      { name: "neck", file: "neck.png", group: "body", pivotX: 648.0, pivotY: 230.0 },
      { name: "neckwear", file: "neckwear.png", group: "body", pivotX: 648.0, pivotY: 250.0 },
      { name: "topwear", file: "topwear.png", group: "body", pivotX: 644.5, pivotY: 398.0 },
      { name: "handwear", file: "handwear.png", group: "body", pivotX: 640.0, pivotY: 480.0 },
      
      // Grupo de Cabeça & Rosto
      { name: "head", file: "head.png", group: "head", pivotX: 645.5, pivotY: 161.0 },
      { name: "face", file: "face.png", group: "head", pivotX: 662.0, pivotY: 160.0 },
      { name: "ears", file: "ears.png", group: "head", pivotX: 650.0, pivotY: 220.0 },
      { name: "earwear", file: "earwear.png", group: "head", pivotX: 750.0, pivotY: 180.0 },

      // Olhos (com suporte a olhar e piscar)
      { name: "eyewhite", file: "eyewhite.png", group: "eyes", pivotX: 638.0, pivotY: 180.0 },
      { name: "irides", file: "irides.png", group: "eyes", pivotX: 639.0, pivotY: 179.0 },
      { name: "eyelash", file: "eyelash.png", group: "eyes", pivotX: 638.0, pivotY: 176.0 },
      { name: "eyebrow", file: "eyebrow.png", group: "head", pivotX: 634.0, pivotY: 147.0 },
      { name: "eyewear", file: "eyewear.png", group: "head", pivotX: 638.0, pivotY: 180.0 },

      { name: "nose", file: "nose.png", group: "head", pivotX: 637.0, pivotY: 201.0 },
      
      // Boca (Pivô exato validado no canal Alpha: x=642.5, y=221.0)
      { name: "mouth", file: "mouth.png", group: "mouth", pivotX: 642.5, pivotY: 221.0 },

      { name: "headwear", file: "headwear.png", group: "head", pivotX: 730.0, pivotY: 160.0 },
      { name: "front_hair", file: "front hair.png", group: "head", pivotX: 628.5, pivotY: 165.5 }
    ];

    for (const def of layerDefs) {
      const layer = new CharacterLayer(def.name, def.file, {
        pivotX: def.pivotX,
        pivotY: def.pivotY
      });
      layer.group = def.group;
      this.layers.push(layer);
      this.layerMap[def.name] = layer;
    }
  }

  async loadAssets(basePath) {
    console.log(`[NexaCharacter] Carregando camadas PNG de: ${basePath}`);
    const promises = this.layers.map((l) => l.load(basePath));
    const results = await Promise.all(promises);
    const loadedCount = results.filter(Boolean).length;
    console.log(`[NexaCharacter] ${loadedCount}/${this.layers.length} camadas carregadas.`);
    this.isFullyLoaded = true;
    return loadedCount > 0;
  }

  render(ctx, canvasWidth, canvasHeight) {
    if (!this.isFullyLoaded) return;

    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Ajusta o enquadramento central mantendo a proporção 1280x1280 no canvas
    const scale = Math.min(canvasWidth / 1280, canvasHeight / 1280);
    const offsetX = (canvasWidth - 1280 * scale) / 2;
    const offsetY = (canvasHeight - 1280 * scale) / 2;

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Renderiza cada camada aplicando as transformações do nó pai correspondente
    for (const layer of this.layers) {
      let parentTransform = {};

      if (layer.group === "body") {
        parentTransform = this.nodes.body;
      } else if (layer.group === "head" || layer.group === "eyes" || layer.group === "mouth") {
        // A cabeça herda transformações do corpo + suas próprias transformações
        parentTransform = {
          x: this.nodes.body.x + this.nodes.head.x,
          y: this.nodes.body.y + this.nodes.head.y,
          scaleX: this.nodes.body.scaleX * this.nodes.head.scaleX,
          scaleY: this.nodes.body.scaleY * this.nodes.head.scaleY,
          rotation: this.nodes.body.rotation + this.nodes.head.rotation,
          pivotX: this.nodes.head.pivotX,
          pivotY: this.nodes.head.pivotY
        };
      }

      // Ajustes específicos por nó de controle
      if (layer.name === "irides") {
        layer.x = this.nodes.eyes.offsetX;
        layer.y = this.nodes.eyes.offsetY;
      } else if (layer.name === "eyelash") {
        layer.scaleY = this.nodes.eyes.scaleY;
      } else if (layer.name === "mouth") {
        layer.scaleY = this.nodes.mouth.scaleY;
        layer.scaleX = this.nodes.mouth.scaleX;
        layer.y = this.nodes.mouth.offsetY;
      }

      layer.draw(ctx, parentTransform);
    }

    ctx.restore();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CharacterLayer, NexaCharacter };
}
