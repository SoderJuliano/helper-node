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
      // Inject the response content into the loaded page, keeping the close button
      osNotificationWindow.webContents.executeJavaScript(`
        // Create content container if it doesn't exist
        let contentContainer = document.getElementById('response-content');
        if (!contentContainer) {
          contentContainer = document.createElement('div');
          contentContainer.id = 'response-content';
          contentContainer.style.marginTop = '30px'; // Space for close button
          document.body.appendChild(contentContainer);
        }
        
        // Insert the response content
        contentContainer.innerHTML = ${JSON.stringify(content)};
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
            }
            body::-webkit-scrollbar { display: none; }
            body { -ms-overflow-style: none; scrollbar-width: none; }
            .close-btn {
              position: absolute;
              top: 5px;
              right: 8px;
              background: none;
              border: none;
              color: #fff;
              font-size: 18px;
              cursor: pointer;
              opacity: 1;
              padding: 0;
              width: 20px;
              height: 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 1000;
            }
          </style>
        </head>
        <body>
          <button class="close-btn" onclick="window.close()">×</button>
          <div style="margin-top: 30px;">${content}</div>
        </body>
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
