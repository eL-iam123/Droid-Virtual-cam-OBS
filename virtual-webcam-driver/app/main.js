const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 400,
    webPreferences: {
      preload: __dirname + '/preload.js'
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Start webcam
ipcMain.handle('start-webcam', async () => {
  exec('bash ../bin/start.sh');
  return "started";
});

// Stop webcam
ipcMain.handle('stop-webcam', async () => {
  exec('pkill droidcam-cli');
  return "stopped";
});