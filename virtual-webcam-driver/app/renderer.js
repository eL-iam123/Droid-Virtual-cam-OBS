const stateStore = {
  current: null
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function formatTimestamp(value) {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function setActionMessage(message, tone = 'muted') {
  elements.actionSummary.textContent = message;
  elements.actionSummary.dataset.tone = tone;
}

function healthLabel(state) {
  if (state.running && state.previewStatus === 'online') {
    return 'Live';
  }
  if (state.running) {
    return 'Running';
  }
  if (state.scanInFlight) {
    return 'Scanning';
  }
  return 'Idle';
}

function serviceLabel(serviceStatus) {
  if (!serviceStatus.available) {
    return 'Not installed';
  }
  return `${serviceStatus.activeState} / ${serviceStatus.subState}`;
}

function renderProfileButtons(state) {
  elements.profileList.innerHTML = '';
  for (const profile of state.profiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-chip ${profile.id === state.profile.id ? 'is-selected' : ''}`;
    button.innerHTML = `
      <span class="profile-name">${escapeHtml(profile.label)}</span>
      <span class="profile-meta">${escapeHtml(profile.size)} · ${profile.enableAudio ? 'audio' : 'video only'}</span>
    `;
    button.addEventListener('click', async () => {
      await window.api.updateSettings({ selectedProfile: profile.id });
      setActionMessage(`Profile switched to ${profile.label}.`);
    });
    elements.profileList.appendChild(button);
  }
  elements.profileNotes.textContent = state.profile.notes;
}

function renderSources(state) {
  elements.sourcesList.innerHTML = '';

  if (!state.scanResults.length) {
    const empty = document.createElement('div');
    empty.className = 'source-empty';
    empty.textContent = state.scanInFlight ? 'Scanning the local subnet…' : 'No DroidCam endpoint detected yet.';
    elements.sourcesList.appendChild(empty);
  }

  for (const source of state.scanResults) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `source-chip ${source.host === state.settings.host ? 'is-selected' : ''}`;
    button.innerHTML = `
      <span>${escapeHtml(source.label)}</span>
      <span>${escapeHtml(`${source.host}:${source.port}`)}</span>
    `;
    button.addEventListener('click', async () => {
      const nextState = await window.api.updateSettings({ host: source.host, port: source.port });
      render(nextState);
      setActionMessage(`Selected ${source.host}:${source.port}.`);
      await window.api.setPreviewStatus('connecting');
    });
    elements.sourcesList.appendChild(button);
  }

  elements.scanMeta.textContent = state.lastScanAt
    ? `Last scan: ${formatTimestamp(state.lastScanAt)}`
    : 'Last scan: pending';
}

function renderVideoDevices(state) {
  elements.videoDevicesList.innerHTML = '';

  if (!state.videoDevices.length) {
    const empty = document.createElement('div');
    empty.className = 'device-empty';
    empty.textContent = 'No V4L2 loopback device detected. Load v4l2loopback, then point OBS to that /dev/videoN device.';
    elements.videoDevicesList.appendChild(empty);
  }

  for (const device of state.videoDevices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `device-chip ${state.outputDevice?.path === device.path ? 'is-selected' : ''}`;
    button.innerHTML = `
      <span>${escapeHtml(device.path)}</span>
      <span>${escapeHtml(device.label)}</span>
    `;
    button.addEventListener('click', async () => {
      const nextState = await window.api.updateSettings({ videoDevice: device.path });
      render(nextState);
      setActionMessage(`Output device pinned to ${device.path}.`, 'success');
    });
    elements.videoDevicesList.appendChild(button);
  }

  elements.deviceMeta.textContent = state.outputDevice
    ? `OBS should use ${state.outputDevice.path}${state.outputDevice.label ? ` · ${state.outputDevice.label}` : ''}`
    : 'Output device missing';
}

function renderLogs(state) {
  elements.logsPanel.textContent = state.logs
    .map((entry) => {
      const level = entry.level.toUpperCase().padEnd(5, ' ');
      return `${entry.timestamp} [${level}] ${entry.source}: ${entry.message}`;
    })
    .join('\n');
  elements.logsPanel.scrollTop = elements.logsPanel.scrollHeight;
  elements.journalMeta.textContent = state.settings.journalUnit;
}

function renderPreview(state) {
  const nextSrc = state.previewUrl || '';
  if (elements.previewImage.dataset.src !== nextSrc) {
    elements.previewImage.dataset.src = nextSrc;
    elements.previewImage.src = nextSrc;
  }

  const overlayMessages = {
    idle: nextSrc ? 'Preview ready. Start the driver or confirm DroidCam HTTP access.' : 'No preview source selected.',
    connecting: 'Connecting to DroidCam stream…',
    online: '',
    error: 'Preview unavailable. Check host, port, and DroidCam HTTP access.'
  };

  elements.previewOverlay.textContent = nextSrc ? overlayMessages[state.previewStatus] || '' : 'No preview source selected.';
  elements.previewOverlay.classList.toggle('is-hidden', Boolean(nextSrc && state.previewStatus === 'online'));
  elements.previewUrlLabel.textContent = state.previewDisplayUrl || 'No endpoint selected';
}

function renderStatus(state) {
  elements.hostInput.value = state.settings.host;
  elements.portInput.value = String(state.settings.port);
  elements.videoDeviceInput.value = state.settings.videoDevice || state.outputDevice?.path || '';
  elements.appHealth.textContent = healthLabel(state);
  elements.driverState.textContent = state.running ? `Running${state.processPid ? ` · PID ${state.processPid}` : ''}` : 'Stopped';
  elements.previewState.textContent = state.previewStatus;
  elements.serviceState.textContent = serviceLabel(state.serviceStatus);
  elements.profileState.textContent = `${state.profile.label} · ${state.profile.size}`;
  elements.targetState.textContent = state.settings.host ? `${state.settings.host}:${state.settings.port}` : 'Not selected';
  elements.capabilityState.textContent = state.capabilities.hasObs && state.capabilities.hasJournalctl && state.capabilities.hasDroidCamCli ? 'Ready' : 'Partial';
  elements.outputState.textContent = state.outputDevice ? `${state.outputDevice.path} · ${state.outputDevice.label}` : 'Missing';
  elements.backendState.textContent = state.driverBackend;
  elements.startButton.disabled = state.running;
  elements.stopButton.disabled = !state.running;
  elements.scanButton.disabled = state.scanInFlight;
  elements.obsButton.disabled = !state.capabilities.hasObs;
  elements.windowMinimize.disabled = !state.window.canMinimize;
  elements.windowMaximize.disabled = !state.window.canMaximize;
  elements.windowMaximize.textContent = state.window.isMaximized ? 'Restore' : 'Maximize';
  elements.appHealth.dataset.health = state.running ? 'live' : state.scanInFlight ? 'busy' : 'idle';
}

function render(state) {
  stateStore.current = state;
  renderProfileButtons(state);
  renderSources(state);
  renderVideoDevices(state);
  renderPreview(state);
  renderStatus(state);
  renderLogs(state);
}

async function refreshState() {
  const state = await window.api.getState();
  render(state);
}

async function startDriver() {
  try {
    setActionMessage('Starting driver…');
    const state = await window.api.start();
    render(state);
    setActionMessage(`Driver launched on ${state.outputDevice?.path || 'the selected output device'}.`, 'success');
  } catch (error) {
    setActionMessage(error.message, 'error');
  }
}

async function stopDriver() {
  try {
    setActionMessage('Stopping driver…');
    const state = await window.api.stop();
    render(state);
    setActionMessage('Driver stop signal sent.');
  } catch (error) {
    setActionMessage(error.message, 'error');
  }
}

async function scanNetwork() {
  try {
    setActionMessage('Scanning local subnets for DroidCam endpoints…');
    const state = await window.api.scanNetwork();
    render(state);
    setActionMessage(`Scan completed with ${state.scanResults.length} candidate(s).`);
  } catch (error) {
    setActionMessage(error.message, 'error');
  }
}

async function launchObs() {
  try {
    setActionMessage('Launching OBS…');
    const state = await window.api.launchObs();
    render(state);
    setActionMessage(`OBS launched. Use Video Capture Device -> ${state.outputDevice?.path || 'the selected /dev/videoN device'}.`, 'success');
  } catch (error) {
    setActionMessage(error.message, 'error');
  }
}

async function syncSettings() {
  const host = elements.hostInput.value.trim();
  const port = Number(elements.portInput.value) || 4747;
  const videoDevice = elements.videoDeviceInput.value.trim();
  const state = await window.api.updateSettings({ host, port, videoDevice });
  render(state);
  await window.api.setPreviewStatus(host ? 'connecting' : 'idle');
}

function bindEvents() {
  elements.scanButton.addEventListener('click', scanNetwork);
  elements.startButton.addEventListener('click', startDriver);
  elements.stopButton.addEventListener('click', stopDriver);
  elements.obsButton.addEventListener('click', launchObs);
  elements.windowMinimize.addEventListener('click', () => {
    window.api.minimizeWindow();
  });
  elements.windowMaximize.addEventListener('click', async () => {
    const state = await window.api.toggleMaximizeWindow();
    render(state);
  });
  elements.hostInput.addEventListener('change', syncSettings);
  elements.portInput.addEventListener('change', syncSettings);
  elements.videoDeviceInput.addEventListener('change', syncSettings);

  elements.previewImage.addEventListener('load', () => {
    window.api.setPreviewStatus('online');
  });
  elements.previewImage.addEventListener('error', () => {
    const state = stateStore.current;
    if (state && state.previewUrl) {
      window.api.setPreviewStatus('error');
    }
  });
}

function captureElements() {
  elements.appHealth = $('appHealth');
  elements.windowMinimize = $('windowMinimize');
  elements.windowMaximize = $('windowMaximize');
  elements.scanButton = $('scanButton');
  elements.startButton = $('startButton');
  elements.stopButton = $('stopButton');
  elements.obsButton = $('obsButton');
  elements.hostInput = $('hostInput');
  elements.portInput = $('portInput');
  elements.videoDeviceInput = $('videoDeviceInput');
  elements.scanMeta = $('scanMeta');
  elements.deviceMeta = $('deviceMeta');
  elements.sourcesList = $('sourcesList');
  elements.videoDevicesList = $('videoDevicesList');
  elements.profileList = $('profileList');
  elements.profileNotes = $('profileNotes');
  elements.actionSummary = $('actionSummary');
  elements.driverState = $('driverState');
  elements.previewState = $('previewState');
  elements.serviceState = $('serviceState');
  elements.profileState = $('profileState');
  elements.targetState = $('targetState');
  elements.capabilityState = $('capabilityState');
  elements.outputState = $('outputState');
  elements.backendState = $('backendState');
  elements.previewImage = $('previewImage');
  elements.previewOverlay = $('previewOverlay');
  elements.previewUrlLabel = $('previewUrlLabel');
  elements.logsPanel = $('logsPanel');
  elements.journalMeta = $('journalMeta');
}

window.addEventListener('DOMContentLoaded', async () => {
  captureElements();
  bindEvents();
  await refreshState();
  window.api.onState((state) => render(state));
  window.api.onLog((entry) => {
    const state = stateStore.current;
    if (state) {
      state.logs = [...state.logs, entry].slice(-400);
      renderLogs(state);
    }
  });
});
