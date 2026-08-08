/**
 * scripts/audit-nexa-layers.js
 * Script de auditoria técnica dos assets de camada da Nexa.
 * Utiliza o Sharp para analisar transparência, bounding boxes, dimensões e distribuição espacial.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const layersDir = "/home/soder/Documents/nexa-workspace/see-through/workspace/layerdiff_output/Nexa_front_cutout";

async function auditLayers() {
  console.log("🔍 Iniciando Auditoria dos Assets da Nexa...");
  const files = fs.readdirSync(layersDir).filter(f => f.endsWith(".png") && !f.includes("_depth"));
  
  const auditResults = [];

  for (const file of files) {
    const filePath = path.join(layersDir, file);
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // Trim para encontrar o bounding box dos pixels não-transparentes
    const trimmed = await sharp(filePath).trim().toBuffer({ resolveWithObject: true });
    
    auditResults.push({
      file,
      width: metadata.width,
      height: metadata.height,
      trimWidth: trimmed.info.width,
      trimHeight: trimmed.info.height,
      left: trimmed.info.trimOffsetLeft,
      top: trimmed.info.trimOffsetTop,
      right: trimmed.info.trimOffsetLeft + trimmed.info.width,
      bottom: trimmed.info.trimOffsetTop + trimmed.info.height
    });
  }

  console.log("\n📊 RESULTADO DA AUDITORIA DE CAMADAS:");
  console.table(auditResults.map(r => ({
    Arquivo: r.file,
    BoundingBox: `X:[${r.left}..${r.right}] Y:[${r.top}..${r.bottom}]`,
    Dimensões: `${r.trimWidth}x${r.trimHeight}`
  })));
}

auditLayers().catch(console.error);
