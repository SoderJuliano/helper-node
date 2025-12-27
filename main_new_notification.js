// Nova implementação da função createOsNotificationWindow
function createOsNotificationWindow(type, content) {
  console.log(`🔔 Creating OS notification - Type: ${type}, Content: ${content.substring(0, 50)}...`);
  
  // FORCE CLOSE existing notification using new helper function
  destroyNotificationWindow();

  // Set dynamic dimensions based on type - matching the original HTML file dimensions
  let windowWidth = 160;
  let windowHeight = 96;
  
  if (type === 'response') {
    windowWidth = 400;
    windowHeight = 260;
  } else if (type === 'recording') {
    windowWidth = 160;
    windowHeight = 96;
  } else if (type === 'loading') {
    windowWidth = 160;
    windowHeight = 96;
  }

  osNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Position in top right corner
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  osNotificationWindow.setPosition(width - windowWidth - 20, 60);

  // Use external HTML files instead of inline HTML
  let filePath;
  
  if (type === 'loading') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'loading.html');
    osNotificationWindow.loadFile(filePath).catch(error => {
      console.error(`Error loading ${type} notification file:`, error);
      // Fallback to simple notification
      const fallbackHtml = `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:15px;background:rgba(30,30,30,0.95);color:white;font-family:monospace;">
          ${content}
        </body>
        </html>
      `;
      osNotificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
    });
  } else if (type === 'recording') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording.html');
    osNotificationWindow.loadFile(filePath).catch(error => {
      console.error(`Error loading ${type} notification file:`, error);
      // Fallback to simple notification
      const fallbackHtml = `
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:15px;background:rgba(30,30,30,0.95);color:white;font-family:monospace;">
          ${content}
        </body>
        </html>
      `;
      osNotificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
    });
  } else if (type === 'response') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'response.html');
    
    // For response notifications, we need to inject the content
    // First load the template, then inject content via JavaScript
    osNotificationWindow.loadFile(filePath).then(() => {
      // Inject the response content into the loaded page
      osNotificationWindow.webContents.executeJavaScript(`
        document.body.innerHTML = ${JSON.stringify(content)};
        
        // Re-apply click-to-copy functionality after content injection
        document.querySelectorAll('pre code').forEach(codeElement => {
          codeElement.style.cursor = 'pointer';
          codeElement.addEventListener('click', async (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const codeText = codeElement.textContent.trim();
            try {
              await navigator.clipboard.writeText(codeText);
              // Visual feedback
              const originalBg = codeElement.style.backgroundColor;
              codeElement.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
              setTimeout(() => {
                codeElement.style.backgroundColor = originalBg;
              }, 500);
            } catch (err) {
              console.error('Erro ao copiar código:', err);
            }
          });
        });
        
        // Add click-to-copy for inline code
        document.querySelectorAll('code:not(pre code)').forEach(codeElement => {
          codeElement.style.cursor = 'pointer';
          codeElement.addEventListener('click', async (e) => {
            const codeText = codeElement.textContent.trim();
            try {
              await navigator.clipboard.writeText(codeText);
              // Visual feedback
              const originalBg = codeElement.style.backgroundColor;
              codeElement.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
              setTimeout(() => {
                codeElement.style.backgroundColor = originalBg;
              }, 500);
            } catch (err) {
              console.error('Erro ao copiar código inline:', err);
            }
          });
        });
      `);
    }).catch(error => {
      console.error('Error loading response notification file:', error);
      // Fallback to creating a simple response window
      const fallbackHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 20px;
              background: rgba(30, 30, 30, 0.95);
              border-radius: 10px;
              backdrop-filter: blur(10px);
              color: white;
              font-family: "Source Code Pro", monospace;
              font-size: 14px;
              overflow-y: auto;
              max-height: 260px;
            }
          </style>
        </head>
        <body>${content}</body>
        </html>
      `;
      osNotificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
    });
  }

  // Auto-close after 10 seconds for responses
  if (type === 'response') {
    setTimeout(() => {
      if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
        console.log(`🔔 Auto-closing response notification after 10 seconds`);
        osNotificationWindow.destroy(); // Use destroy for immediate close
      }
    }, 10000);
  }

  osNotificationWindow.on('closed', () => {
    console.log(`🔔 OS notification window closed - Type: ${type}`);
    osNotificationWindow = null;
  });
}
