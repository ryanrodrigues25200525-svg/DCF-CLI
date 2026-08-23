const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startBackend, stopBackend, startFrontend, stopFrontend } = require('./backendProcess');

let mainWindow;

const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

const logFile = path.join(userDataPath, 'desktop.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(msg);
}

function getIdentity() {
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return data.identity || null;
    } catch (e) {
      log('Error reading config: ' + e.message);
    }
  }
  return null;
}

function saveIdentity(identity) {
  let data = {};
  if (fs.existsSync(configPath)) {
    try {
      data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { }
  }
  data.identity = identity;
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
  log('Identity saved');
}

const isDev = !app.isPackaged;
// Wait for frontend port
const frontendPort = 3000;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

async function waitForHttp(urls, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(urls);

  while (pending.size > 0 && Date.now() < deadline) {
    await Promise.all([...pending].map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok || response.status < 500) {
          pending.delete(url);
        }
      } catch (error) {
        // Service is still starting.
      }
    }));

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (pending.size > 0) {
    throw new Error(`Timed out waiting for services: ${[...pending].join(', ')}`);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'DCF Builder Pro',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  setupMenu();

  const loadApp = () => {
    const identity = getIdentity();
    if (!identity) {
      mainWindow.loadURL(`${frontendUrl}/desktop/identity`);
    } else {
      mainWindow.loadURL(frontendUrl);
    }
  };

  loadApp();
}

function setupMenu() {
  const template = [
    {
      label: app.name || 'DCF Builder Pro',
      submenu: [
        { label: 'About DCF Builder Pro', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Identity',
          click: () => {
            if (mainWindow) {
              mainWindow.loadURL(`${frontendUrl}/desktop/identity`);
            }
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  log('Electron app ready');
  ipcMain.handle('get-identity', () => getIdentity());
  ipcMain.handle('save-identity', async (event, identity) => {
    saveIdentity(identity);
    // Restart backend with new identity
    await stopBackend(log);
    await startBackend(identity, log, isDev);
    mainWindow.loadURL(frontendUrl);
    return true;
  });
  ipcMain.handle('get-backend-url', () => {
    const port = process.env.DCF_BACKEND_PORT || 8000;
    return `http://127.0.0.1:${port}`;
  });

  // Start processes
  try {
    const identity = getIdentity();
    await startBackend(identity, log, isDev);
    await startFrontend(log, isDev);

    const backendPort = process.env.DCF_BACKEND_PORT || 8000;
    log('Waiting for backend and frontend to be ready...');
    await waitForHttp([
      `http://127.0.0.1:${backendPort}/health`,
      `http://127.0.0.1:${frontendPort}`
    ], 180000);
    log('Services are ready.');
    createMainWindow();
  } catch (err) {
    log('Error starting services: ' + err.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    await stopFrontend(log);
    await stopBackend(log);
  } catch (e) {
    log('Error during shutdown: ' + (e && e.message ? e.message : String(e)));
  } finally {
    app.exit(0);
  }
});
