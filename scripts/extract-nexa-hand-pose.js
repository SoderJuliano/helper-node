/**
 * scripts/extract-nexa-hand-pose.js
 * Extrai o asset da pose da mão/braço a partir do arquivo original do workspace
 * e gera a camada isolada hand_pose_chin.png no diretório renderer/nexa/assets/.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const sourcePath = "/home/soder/Documents/nexa-workspace/Nexa-right-hand-up-on-the-glasses.png";
const outputDir = path.resolve(__dirname, "../renderer/nexa/assets");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function processHandAsset() {
  console.log("✂️ Processando asset original da mão erguida:", sourcePath);
  if (!fs.existsSync(sourcePath)) {
    console.error("❌ Arquivo não encontrado:", sourcePath);
    return;
  }

  const destPath = path.join(outputDir, "hand_pose_chin.png");

  // Redimensiona o asset fonte de 1024x1536 para enquadramento 1280x1280
  const resized = await sharp(sourcePath)
    .resize(1280, 1280, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // Extrai a região da mão e braço erguido (X: 520..1020, Y: 120..720)
  const cropped = await sharp(resized)
    .extract({ left: 520, top: 120, width: 500, height: 600 })
    .toBuffer();

  // Compoe em canvas transparente 1280x1280 alinhado globalmente
  await sharp({
    create: {
      width: 1280,
      height: 1280,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([{ input: cropped, left: 520, top: 120 }])
  .png()
  .toFile(destPath);

  console.log(`✅ Asset da pose de mão erguida gerado com sucesso em: ${destPath}`);
}

processHandAsset().catch(console.error);
