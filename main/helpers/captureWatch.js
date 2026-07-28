// main/helpers/captureWatch.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  execPromise
} = require('../globals.js');

helpers.detectActiveSelectionInterface = async function() {
  try {
    // Check for active screenshot selection processes - don't fail if no matches
    const { stdout } = await execPromise('ps aux | grep -E "(gnome-screenshot|flameshot|spectacle|maim|scrot|grim|slurp|grimshot|ksnip|deepin-screenshot|xfce4-screenshooter)" | grep -v grep || true');
    
    if (!stdout.trim()) {
      return false;
    }

    const processes = stdout.split('\n').filter(line => line.trim());
    
    for (const process of processes) {
      // GNOME Screenshot in area selection mode
      if (process.includes('gnome-screenshot') && (process.includes('-a') || process.includes('--area'))) {
        return true;
      }
      
      // Flameshot in GUI mode (interactive selection)
      if (process.includes('flameshot') && process.includes('gui')) {
        return true;
      }
      
      // Spectacle in region mode
      if (process.includes('spectacle') && (process.includes('-r') || process.includes('--region'))) {
        return true;
      }
      
      // Maim with selection flag
      if (process.includes('maim') && (process.includes('-s') || process.includes('--select'))) {
        return true;
      }
      
      // Scrot with selection flag
      if (process.includes('scrot') && process.includes('-s')) {
        return true;
      }
      
      // Wayland tools
      if (process.includes('grim') || process.includes('slurp') || process.includes('grimshot')) {
        return true;
      }
      
      // Other tools
      if (process.includes('ksnip') || process.includes('deepin-screenshot') || process.includes('xfce4-screenshooter')) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

helpers.startCaptureToolMonitoring = function() {
  if (helpers.isTranslationOnlyMode()) {
    console.log('[mutex] captureToolMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (state.captureToolInterval) {
    clearInterval(state.captureToolInterval);
  }

  console.log('🎯 Iniciando monitoramento de interface de seleção');
  
  let captureActive = false;
  
  state.captureToolInterval = setInterval(async () => {
    const isCapturing = await helpers.detectActiveSelectionInterface();
    
    if (isCapturing && !captureActive) {
      // Selection interface just opened
      captureActive = true;
      helpers.createCaptureWindow();
      console.log('📸 Interface de seleção aberta');
    } else if (!isCapturing && captureActive) {
      // Selection interface just closed
      captureActive = false;
      helpers.destroyCaptureWindow();
      console.log('📸 Interface de seleção fechada');
    }
  }, 500); // Check every 500ms for better responsiveness
}

helpers.stopCaptureToolMonitoring = function() {
  if (state.captureToolInterval) {
    clearInterval(state.captureToolInterval);
    state.captureToolInterval = null;
    console.log('🎯 Monitoramento de captura parado');
  }
  
  helpers.destroyCaptureWindow();
}

helpers.detectCaptureTools = async function() {
  try {
    // Lista de ferramentas de captura comuns no Linux
    const captureTools = [
      'gnome-screenshot',
      'spectacle', 
      'flameshot',
      'shutter',
      'deepin-screenshot',
      'grim',
      'slurp',
      'ksnip',
      'xfce4-screenshooter',
      'kcreenshot'
    ];
    
    // Verificar se alguma ferramenta está rodando
    for (const tool of captureTools) {
      try {
        const { stdout } = await execPromise(`pgrep -f ${tool} 2>/dev/null || echo ''`);
        if (stdout.trim()) {
          console.log(`📸 Ferramenta de captura detectada: ${tool}`);
          return tool;
        }
      } catch (e) {
        // Continua para próxima ferramenta
      }
    }
    return false;
  } catch (error) {
    console.error('Erro ao detectar ferramentas de captura:', error);
    return false;
  }
}

helpers.pickImageMime = function(typesText) {
  if (!typesText) return null;
  const t = typesText.toLowerCase();
  const order = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-bmp'];
  for (const m of order) {
    if (t.includes(m)) return m;
  }
  // Último recurso: qualquer image/*
  const generic = t.match(/image\/[a-z0-9.+-]+/i);
  return generic ? generic[0] : null;
}

helpers.compressImageForVision = async function(inputBase64OrBuffer, label = '') {
  try {
    const sharp = require('sharp');
    const inputBuffer = Buffer.isBuffer(inputBase64OrBuffer)
      ? inputBase64OrBuffer
      : Buffer.from(inputBase64OrBuffer, 'base64');
    const beforeKB = Math.round(inputBuffer.length / 1024);

    const output = await sharp(inputBuffer)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    const afterKB = Math.round(output.length / 1024);
    console.log(`📦 imagem comprimida${label ? ' [' + label + ']' : ''}: ${beforeKB} KB → ${afterKB} KB`);
    return {
      dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
      base64: output.toString('base64'),
      kb: afterKB,
    };
  } catch (e) {
    console.warn('⚠️ falha ao comprimir imagem (mandando original):', e.message);
    const base64 = Buffer.isBuffer(inputBase64OrBuffer)
      ? inputBase64OrBuffer.toString('base64')
      : inputBase64OrBuffer;
    return { dataUrl: `data:image/png;base64,${base64}`, base64, kb: Math.round(base64.length * 0.75 / 1024) };
  }
}
