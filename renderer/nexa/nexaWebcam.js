/**
 * renderer/nexa/nexaWebcam.js
 * Utilitário de captura de webcam (visão da Nexa) para análise visual.
 */

let webcamStream = null;

async function captureWebcamFrame() {
  try {
    if (!webcamStream) {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    }
    const tempVideo = document.createElement("video");
    tempVideo.srcObject = webcamStream;
    tempVideo.play();

    await new Promise((resolve) => {
      tempVideo.onloadedmetadata = () => resolve();
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 640;
    tempCanvas.height = 480;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(tempVideo, 0, 0, 640, 480);

    tempVideo.pause();
    tempVideo.srcObject = null;

    return tempCanvas.toDataURL("image/jpeg");
  } catch (err) {
    console.error("[NexaWebcam] Falha ao capturar webcam:", err.message);
    return null;
  }
}

function initNexaWebcam() {
  if (window.electronAPI && window.electronAPI.onRequestWebcam) {
    window.electronAPI.onRequestWebcam(async ({ requestId }) => {
      console.log("[NexaWebcam] Solicitação de webcam recebida. Capturando frame...");
      const base64 = await captureWebcamFrame();
      if (window.electronAPI.sendWebcamReply) {
        window.electronAPI.sendWebcamReply(requestId, base64);
      }
    });
  }
}

if (typeof window !== "undefined") {
  window.initNexaWebcam = initNexaWebcam;
  window.captureWebcamFrame = captureWebcamFrame;
}
