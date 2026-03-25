const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const PROFILES_PATH = path.join(CONFIG_DIR, 'profiles.json');
const START_SCRIPT_PATH = path.join(ROOT_DIR, 'bin', 'start.sh');
const DEMO_FEED_PATH = path.join(ROOT_DIR, 'docs', 'assets', 'demo-feed.svg');
const SERVICE_UNIT = 'virtual-webcam-driver.service';
const LOG_LIMIT = 400;
const DEMO_MODE = process.env.VIRTUAL_WEBCAM_DRIVER_DEMO === '1';
const CAPTURE_PATH = process.env.VIRTUAL_WEBCAM_DRIVER_CAPTURE_PATH || '';

let mainWindow = null;
let profiles = loadProfiles();
let settings = loadSettings();
const capabilities = detectCapabilities();

const runtime = {
  child: null,
  journal: null,
  logs: [],
  scanResults: [],
  scanInFlight: false,
  lastScanAt: null,
  previewStatus: DEMO_MODE ? 'online' : 'idle',
  demoRunning: DEMO_MODE,
  serviceStatus: {
    available: false,
    activeState: 'unknown',
    subState: 'unknown',
    mainPid: 0,
    detail: 'Not checked yet'
  },
  statusTimer: null,
  captureRequested: Boolean(CAPTURE_PATH)
};

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallbackValue;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadProfiles() {
  const fallbackProfiles = {
    gaming: {
      label: 'Gaming',
      description: '720p video-only profile tuned for stable frame pacing.',
      size: '1280x720',
      previewSize: '1280x720',
      enableAudio: false,
      scanTimeoutMs: 220,
      reconnectBias: 'aggressive',
      notes: 'Use when OBS is live and you want predictable overhead.'
    }
  };
  return readJson(PROFILES_PATH, fallbackProfiles);
}

function sanitizeSettings(raw) {
  const profileIds = Object.keys(profiles);
  const defaultProfile = profileIds.includes('recording') ? 'recording' : profileIds[0];
  const port = Number(raw?.port);
  return {
    selectedProfile: profileIds.includes(raw?.selectedProfile) ? raw.selectedProfile : defaultProfile,
    sourceMode: raw?.sourceMode || 'wifi',
    host: String(raw?.host || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4747,
    videoDevice: String(raw?.videoDevice || '').trim(),
    journalUnit: String(raw?.journalUnit || SERVICE_UNIT).trim() || SERVICE_UNIT
  };
}

function loadSettings() {
  ensureDirectory(CONFIG_DIR);
  const nextSettings = sanitizeSettings(readJson(SETTINGS_PATH, {}));
  writeJson(SETTINGS_PATH, nextSettings);
  return nextSettings;
}

function detectCapabilities() {
  return {
    droidcamCli: resolveCommand('droidcam-cli'),
    journalctl: resolveCommand('journalctl'),
    systemctl: resolveCommand('systemctl'),
    obs: resolveCommand('obs')
  };
}

function resolveCommand(commandName) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, commandName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (error) {
      continue;
    }
  }
  return '';
}

function getProfile(profileId = settings.selectedProfile) {
  const entry = profiles[profileId];
  if (entry) {
    return { id: profileId, ...entry };
  }
  const firstId = Object.keys(profiles)[0];
  return { id: firstId, ...profiles[firstId] };
}

function logEntry(source, level, message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    source,
    level,
    message
  };
  runtime.logs.push(entry);
  if (runtime.logs.length > LOG_LIMIT) {
    runtime.logs = runtime.logs.slice(-LOG_LIMIT);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-entry', entry);
  }
}

function logChunk(source, level, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim()) {
      logEntry(source, level, line);
    }
  }
}

function buildPreviewUrl() {
  if (DEMO_MODE) {
    return pathToFileURL(DEMO_FEED_PATH).href;
  }
  if (!settings.host || settings.sourceMode !== 'wifi') {
    return '';
  }
  const activeProfile = getProfile();
  return `http://${settings.host}:${settings.port}/video/force/${encodeURIComponent(activeProfile.previewSize)}`;
}

function isDriverRunning() {
  return Boolean(runtime.demoRunning || (runtime.child && !runtime.child.killed));
}

function buildState() {
  const activeProfile = getProfile();
  return {
    appTitle: 'Virtual Webcam Driver',
    demoMode: DEMO_MODE,
    settings: { ...settings },
    profile: activeProfile,
    profiles: Object.entries(profiles).map(([id, value]) => ({ id, ...value })),
    previewUrl: buildPreviewUrl(),
    previewDisplayUrl: DEMO_MODE
      ? 'demo://droidcam/preview'
      : settings.host && settings.sourceMode === 'wifi'
        ? `http://${settings.host}:${settings.port}/video`
        : '',
    previewStatus: runtime.previewStatus,
    running: isDriverRunning(),
    processPid: runtime.child?.pid || 0,
    scanInFlight: runtime.scanInFlight,
    scanResults: runtime.scanResults,
    lastScanAt: runtime.lastScanAt,
    logs: runtime.logs,
    serviceStatus: runtime.serviceStatus,
    capabilities: {
      hasDroidCamCli: Boolean(capabilities.droidcamCli),
      hasJournalctl: Boolean(capabilities.journalctl),
      hasSystemctl: Boolean(capabilities.systemctl),
      hasObs: Boolean(capabilities.obs)
    }
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-updated', buildState());
  }
}

function persistSettings() {
  writeJson(SETTINGS_PATH, settings);
}

function updateSettings(patch) {
  const previousJournalUnit = settings.journalUnit;
  settings = sanitizeSettings({ ...settings, ...patch });
  persistSettings();
  if (previousJournalUnit !== settings.journalUnit) {
    stopJournalStream();
    void refreshServiceStatus();
  }
  broadcastState();
  return buildState();
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        ...options
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout,
          stderr,
          code: error?.code ?? 0
        });
      }
    );
  });
}

async function refreshServiceStatus() {
  if (DEMO_MODE) {
    runtime.serviceStatus = {
      available: true,
      activeState: 'active',
      subState: 'running',
      mainPid: 8426,
      detail: 'Demo unit loaded'
    };
    return;
  }

  if (!capabilities.systemctl) {
    runtime.serviceStatus = {
      available: false,
      activeState: 'unavailable',
      subState: 'missing',
      mainPid: 0,
      detail: 'systemctl is not on PATH'
    };
    return;
  }

  const result = await runCommand(capabilities.systemctl, [
    '--user',
    'show',
    settings.journalUnit,
    '--property=LoadState',
    '--property=ActiveState',
    '--property=SubState',
    '--property=MainPID'
  ]);

  if (!result.ok) {
    runtime.serviceStatus = {
      available: false,
      activeState: 'unavailable',
      subState: 'missing',
      mainPid: 0,
      detail: (result.stderr || result.stdout || 'systemd user service not installed').trim()
    };
    stopJournalStream();
    return;
  }

  const fields = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const [key, value] = line.split('=');
    if (key && value !== undefined) {
      fields[key] = value.trim();
    }
  }

  runtime.serviceStatus = {
    available: fields.LoadState === 'loaded',
    activeState: fields.ActiveState || 'unknown',
    subState: fields.SubState || 'unknown',
    mainPid: Number(fields.MainPID || 0),
    detail: fields.LoadState === 'loaded' ? 'systemd user unit detected' : 'systemd user unit missing'
  };

  if (runtime.serviceStatus.available && !runtime.journal) {
    startJournalStream();
  }
  if (!runtime.serviceStatus.available) {
    stopJournalStream();
  }
}

function startJournalStream() {
  if (!capabilities.journalctl || runtime.journal) {
    return;
  }
  const child = spawn(
    capabilities.journalctl,
    ['--user', '-f', '-n', '30', '-u', settings.journalUnit, '-o', 'short-iso'],
    {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  runtime.journal = child;
  logEntry('journal', 'info', `Following ${settings.journalUnit} with journalctl`);

  child.stdout.on('data', (chunk) => logChunk('journal', 'info', chunk));
  child.stderr.on('data', (chunk) => logChunk('journal', 'warn', chunk));
  child.on('exit', (code, signal) => {
    if (runtime.journal === child) {
      runtime.journal = null;
    }
    if (!app.isQuitting) {
      logEntry('journal', code === 0 ? 'info' : 'warn', `journalctl stream stopped code=${code ?? 'n/a'} signal=${signal ?? 'n/a'}`);
    }
  });
}

function stopJournalStream() {
  if (runtime.journal) {
    runtime.journal.kill('SIGTERM');
    runtime.journal = null;
  }
}

function buildStartEnvironment() {
  const activeProfile = getProfile();
  return {
    ...process.env,
    PROFILE: activeProfile.id,
    SOURCE_MODE: settings.sourceMode,
    DROIDCAM_HOST: settings.host,
    DROIDCAM_PORT: String(settings.port),
    DROIDCAM_SIZE: activeProfile.size,
    ENABLE_AUDIO: activeProfile.enableAudio ? '1' : '0',
    VIDEO_DEVICE: settings.videoDevice
  };
}

async function startWebcam() {
  if (!capabilities.droidcamCli) {
    throw new Error('droidcam-cli is not installed or not on PATH.');
  }
  if (isDriverRunning()) {
    return buildState();
  }
  if (settings.sourceMode === 'wifi' && !settings.host && !DEMO_MODE) {
    throw new Error('Select or detect a DroidCam host before starting the driver.');
  }

  if (DEMO_MODE) {
    runtime.demoRunning = true;
    logEntry('process', 'info', `Demo start for profile=${settings.selectedProfile} target=${settings.host || '192.168.1.87'}:${settings.port}`);
    runtime.previewStatus = 'online';
    broadcastState();
    return buildState();
  }

  const child = spawn('/bin/bash', [START_SCRIPT_PATH], {
    cwd: ROOT_DIR,
    env: buildStartEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  runtime.child = child;
  runtime.previewStatus = settings.host ? 'connecting' : 'idle';
  logEntry('process', 'info', `Launching ${settings.selectedProfile} profile against ${settings.host}:${settings.port}`);
  broadcastState();

  child.stdout.on('data', (chunk) => logChunk('process', 'info', chunk));
  child.stderr.on('data', (chunk) => logChunk('process', 'error', chunk));
  child.on('exit', (code, signal) => {
    if (runtime.child === child) {
      runtime.child = null;
    }
    logEntry('process', code === 0 ? 'info' : 'error', `Driver exited code=${code ?? 'n/a'} signal=${signal ?? 'n/a'}`);
    runtime.previewStatus = 'idle';
    broadcastState();
  });

  return buildState();
}

async function stopWebcam() {
  if (DEMO_MODE) {
    runtime.demoRunning = false;
    logEntry('process', 'info', 'Demo stop issued');
    runtime.previewStatus = 'idle';
    broadcastState();
    return buildState();
  }

  if (!runtime.child) {
    return buildState();
  }
  const child = runtime.child;
  logEntry('process', 'info', 'Stopping driver');
  child.kill('SIGTERM');
  setTimeout(() => {
    if (runtime.child === child) {
      child.kill('SIGKILL');
    }
  }, 4000);
  return buildState();
}

async function launchObs() {
  if (!capabilities.obs) {
    throw new Error('OBS is not installed or not on PATH.');
  }

  if (DEMO_MODE) {
    logEntry('obs', 'info', 'Demo OBS launch completed');
    return buildState();
  }

  const obsProcess = spawn(capabilities.obs, [], {
    detached: true,
    stdio: 'ignore'
  });
  obsProcess.unref();
  logEntry('obs', 'info', 'OBS launched');
  return buildState();
}

function isCandidateInterface(name) {
  return !/^(lo|docker|br-|veth|virbr|vmnet|zt|tailscale|wg|tun|tap)/i.test(name);
}

function getCandidateHosts() {
  const interfaces = os.networkInterfaces();
  const hosts = [];
  const subnets = new Set();
  if (settings.host) {
    hosts.push(settings.host);
  }

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!isCandidateInterface(name)) {
      continue;
    }
    for (const info of addresses || []) {
      if (info.family !== 'IPv4' || info.internal || !info.address) {
        continue;
      }
      if (info.address.startsWith('169.254.')) {
        continue;
      }
      const octets = info.address.split('.');
      if (octets.length !== 4) {
        continue;
      }
      const subnet = octets.slice(0, 3).join('.');
      if (subnets.has(subnet)) {
        continue;
      }
      subnets.add(subnet);
      const selfSuffix = Number(octets[3]);
      for (let suffix = 1; suffix < 255; suffix += 1) {
        if (suffix === selfSuffix) {
          continue;
        }
        hosts.push(`${subnet}.${suffix}`);
      }
    }
  }

  return Array.from(new Set(hosts)).slice(0, 512);
}

function probeVideoEndpoint(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        method: 'GET',
        path: '/video',
        timeout: timeoutMs
      },
      (response) => {
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        response.destroy();
        if (response.statusCode === 200 && (contentType.includes('multipart/') || contentType.includes('image/'))) {
          resolve(true);
          return;
        }
        resolve(false);
      }
    );

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(false));
    request.end();
  });
}

function probeLandingPage(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        method: 'GET',
        path: '/',
        timeout: timeoutMs
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length < 2048) {
            body += chunk;
          }
        });
        response.on('end', () => resolve(/droidcam/i.test(body)));
      }
    );

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve(false));
    request.end();
  });
}

async function probeHost(host, port, timeoutMs) {
  if (await probeVideoEndpoint(host, port, timeoutMs)) {
    return {
      host,
      port,
      label: `DroidCam ${host}`,
      previewUrl: `http://${host}:${port}/video`
    };
  }
  if (await probeLandingPage(host, port, timeoutMs)) {
    return {
      host,
      port,
      label: `DroidCam ${host}`,
      previewUrl: `http://${host}:${port}/video`
    };
  }
  return null;
}

async function promisePool(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const result = await mapper(items[currentIndex], currentIndex);
      if (result) {
        results.push(result);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function scanNetwork() {
  if (DEMO_MODE) {
    settings.host = '192.168.1.87';
    settings.port = 4747;
    persistSettings();
    runtime.scanResults = [
      {
        host: settings.host,
        port: 4747,
        label: `DroidCam ${settings.host}`,
        previewUrl: pathToFileURL(DEMO_FEED_PATH).href
      }
    ];
    runtime.lastScanAt = new Date().toISOString();
    broadcastState();
    return runtime.scanResults;
  }

  if (runtime.scanInFlight) {
    return runtime.scanResults;
  }

  runtime.scanInFlight = true;
  broadcastState();
  const activeProfile = getProfile();
  const candidates = getCandidateHosts();
  const matches = [];

  try {
    await promisePool(candidates, 32, async (host) => {
      const result = await probeHost(host, settings.port, activeProfile.scanTimeoutMs || 300);
      if (result) {
        matches.push(result);
      }
      return result;
    });

    runtime.scanResults = matches.sort((left, right) => left.host.localeCompare(right.host));
    runtime.lastScanAt = new Date().toISOString();

    if (!settings.host && runtime.scanResults[0]) {
      settings.host = runtime.scanResults[0].host;
      settings.port = runtime.scanResults[0].port;
      persistSettings();
    }

    logEntry('scan', 'info', `Network scan completed with ${runtime.scanResults.length} candidate(s)`);
  } finally {
    runtime.scanInFlight = false;
    broadcastState();
  }

  return runtime.scanResults;
}

function seedDemoState() {
  runtime.demoRunning = true;
  settings = sanitizeSettings({
    ...settings,
    host: '192.168.1.87',
    port: 4747,
    selectedProfile: 'recording'
  });
  persistSettings();
  runtime.scanResults = [
    {
      host: settings.host,
      port: settings.port,
      label: `DroidCam ${settings.host}`,
      previewUrl: pathToFileURL(DEMO_FEED_PATH).href
    }
  ];
  runtime.lastScanAt = new Date().toISOString();
  logEntry('system', 'info', 'Demo mode enabled');
  logEntry('scan', 'info', `Detected DroidCam endpoint at ${settings.host}:${settings.port}`);
  logEntry('process', 'info', `Profile ${settings.selectedProfile} ready with ${getProfile().size}`);
  logEntry('journal', 'info', 'journalctl follow active for virtual-webcam-driver.service');
  logEntry('obs', 'info', 'OBS available on PATH');
}

async function captureWindowIfRequested() {
  if (!runtime.captureRequested || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const outputPath = path.isAbsolute(CAPTURE_PATH) ? CAPTURE_PATH : path.join(ROOT_DIR, CAPTURE_PATH);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await mainWindow.webContents.capturePage();
  ensureDirectory(path.dirname(outputPath));
  fs.writeFileSync(outputPath, image.toPNG());
  app.quit();
}

function createWindow() {
  const initialHeight = runtime.captureRequested ? 1180 : 960;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: initialHeight,
    minWidth: 1180,
    minHeight: 760,
    show: !runtime.captureRequested,
    backgroundColor: '#10201e',
    title: 'Virtual Webcam Driver',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (!runtime.captureRequested) {
    mainWindow.once('ready-to-show', () => mainWindow.show());
  }

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastState();
    void captureWindowIfRequested();
  });
}

function startStatusTimer() {
  if (runtime.statusTimer) {
    clearInterval(runtime.statusTimer);
  }
  runtime.statusTimer = setInterval(async () => {
    await refreshServiceStatus();
    broadcastState();
  }, 3000);
}

app.isQuitting = false;
app.on('before-quit', () => {
  app.isQuitting = true;
  stopJournalStream();
  if (runtime.statusTimer) {
    clearInterval(runtime.statusTimer);
    runtime.statusTimer = null;
  }
  if (runtime.child && !runtime.child.killed) {
    runtime.child.kill('SIGTERM');
  }
});

ipcMain.handle('get-state', async () => buildState());
ipcMain.handle('update-settings', async (_event, patch) => updateSettings(patch));
ipcMain.handle('scan-network', async () => {
  await scanNetwork();
  return buildState();
});
ipcMain.handle('start-webcam', async () => startWebcam());
ipcMain.handle('stop-webcam', async () => stopWebcam());
ipcMain.handle('launch-obs', async () => launchObs());
ipcMain.handle('set-preview-status', async (_event, status) => {
  runtime.previewStatus = ['idle', 'connecting', 'online', 'error'].includes(status) ? status : 'idle';
  broadcastState();
  return buildState();
});

app.whenReady().then(async () => {
  if (DEMO_MODE) {
    seedDemoState();
  }

  await refreshServiceStatus();
  createWindow();
  startStatusTimer();

  if (!DEMO_MODE) {
    setTimeout(() => {
      if (!settings.host) {
        void scanNetwork();
      }
    }, 900);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
