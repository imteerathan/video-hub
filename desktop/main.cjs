const { app, BrowserWindow, session, shell, ipcMain } = require('electron');
const { getUpdateConfig } = require('./update-config.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');

let PORT = Number(process.env.VIDEO_HUB_PORT || 3187);
let serverProcess = null;
let mainWindow = null;
let splashWindow = null;
let serverRoot = null;
let userData = null;

function fallbackLogDir() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Video Hub', 'logs');
}

function logPath() {
  try {
    return path.join(app.getPath('userData'), 'video-hub-desktop.log');
  } catch {
    return path.join(fallbackLogDir(), 'video-hub-desktop.log');
  }
}

function formatLogValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(formatLogValue).join(' ') + '\n';
  const targets = [logPath(), path.join(fallbackLogDir(), 'video-hub-desktop.log')];
  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, line);
      break;
    } catch {}
  }
  try { console.log(...args); } catch {}
}

function bootstrapLogPath() {
  return path.join(fallbackLogDir(), 'video-hub-bootstrap.log');
}

function bootstrapLog(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(formatLogValue).join(' ') + '\n';
  try {
    fs.mkdirSync(path.dirname(bootstrapLogPath()), { recursive: true });
    fs.appendFileSync(bootstrapLogPath(), line);
  } catch {}
  try { console.log(...args); } catch {}
}

process.on('uncaughtException', err => bootstrapLog('[uncaughtException]', err));
process.on('unhandledRejection', err => bootstrapLog('[unhandledRejection]', err));

try {
  fs.mkdirSync(path.dirname(bootstrapLogPath()), { recursive: true });
  bootstrapLog('--- Video Hub bootstrap ---');
  bootstrapLog('Executable:', process.execPath);
  bootstrapLog('Arguments:', process.argv);
  bootstrapLog('Platform:', process.platform, process.arch);
} catch {}

try {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('log-file', bootstrapLogPath());
} catch (err) {
  bootstrapLog('[chromium-logging-init-failed]', err);
}

function appRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '..');
  return path.join(process.resourcesPath, 'app');
}

function checkPort(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function choosePort() {
  const preferred = Number(process.env.VIDEO_HUB_PORT || 3187);
  if (await checkPort(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const chosen = typeof addr === 'object' && addr ? addr.port : preferred;
      srv.close(() => resolve(chosen));
    });
  });
}

function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('Video Hub server did not start in time: ' + url));
      }
      setTimeout(probe, 250);
    };
    const probe = () => {
      const req = http.get(url, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    probe();
  });
}

function runDatabaseBootstrap() {
  const root = appRoot();
  userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'video-hub.db');
  const env = { ...process.env, DATABASE_URL: 'file:' + dbPath, ELECTRON_RUN_AS_NODE: '1' };
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  log('[startup] database bootstrap', { dbPath, prismaCli });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      prismaCli, 'db', 'push',
      '--schema', path.join(root, 'prisma', 'schema.prisma'),
      '--skip-generate'
    ], { cwd: root, env, stdio: 'pipe', windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => {
      stderr += d.toString();
      log('[prisma:err]', d.toString().trim());
    });
    child.stdout.on('data', d => log('[prisma]', d.toString().trim()));
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('Prisma database bootstrap timed out after 30000ms. Check the application log for the Prisma command and database path.'));
    }, 30000);
    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      log('[prisma] exited', code);
      code === 0 ? resolve() : reject(new Error('Prisma database bootstrap failed (' + code + '): ' + stderr));
    });
  });
}

function startServer() {
  const root = appRoot();
  const dbPath = path.join(app.getPath('userData'), 'video-hub.db');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: 'file:' + dbPath,
    ELECTRON_RUN_AS_NODE: '1',
  };
  serverRoot = root;
  const server = path.join(root, '.next', 'standalone', 'server.js');
  log('[startup] starting local server', { server, PORT, dbPath });
  serverProcess = spawn(process.execPath, [server], { cwd: root, env, stdio: 'pipe', windowsHide: true });
  serverProcess.on('error', err => log('[video-hub] server error', err));
  serverProcess.on('exit', (code, signal) => log('[video-hub] server exited', code, signal || ''));
  serverProcess.stdout?.on('data', data => log('[next]', data.toString().trim()));
  serverProcess.stderr?.on('data', data => log('[next:err]', data.toString().trim()));
}

function stopServer() {
  if (!serverProcess) return;
  try { serverProcess.kill(); } catch {}
  serverProcess = null;
}

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => {
        body += c;
        if (body.length > 1024 * 1024) req.destroy(new Error('Response too large'));
      });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP timeout: ' + url)));
  });
}

async function runSmokeTest() {
  const health = await httpGet('http://127.0.0.1:' + PORT + '/api/health');
  if (health.statusCode !== 200 || !health.body.includes('"ok":true')) {
    throw new Error('Health check failed: HTTP ' + health.statusCode + ' ' + health.body);
  }
  const home = await httpGet('http://127.0.0.1:' + PORT + '/');
  if (home.statusCode !== 200 || !home.body.includes('VIDEO HUB')) {
    throw new Error('Home page check failed: HTTP ' + home.statusCode);
  }
  log('HTTP smoke test passed');
}

function startupLoadingHtml() {
  const logFile = String(logPath()).replaceAll('\\', '\\\\');
  const bootstrapFile = String(bootstrapLogPath()).replaceAll('\\', '\\\\');
  return '<!doctype html><html><head><meta charset="utf-8"><title>Video Hub</title>' +
    '<style>*{box-sizing:border-box}body{margin:0;background:#07080a;color:#f4f5f7;font-family:"Segoe UI",system-ui,sans-serif;display:grid;place-items:center;height:100vh;overflow:hidden}' +
    'main{width:min(640px,calc(100vw - 48px));padding:34px 38px;background:linear-gradient(180deg,#11141a,#0d0f13);border:1px solid #292e38;border-radius:22px;box-shadow:0 24px 90px rgba(0,0,0,.45)}' +
    '.brand{font-size:27px;font-weight:850;letter-spacing:.16em;text-align:center}.sub{margin-top:7px;text-align:center;color:#7f8794;font-size:12px;letter-spacing:.04em;text-transform:uppercase}' +
    '.ring{width:48px;height:48px;margin:27px auto 19px;border:4px solid #2b313b;border-top-color:#f1f3f6;border-radius:50%;animation:spin 1s linear infinite}h1{font-size:19px;line-height:1.3;text-align:center;margin:0 0 8px}' +
    'p{margin:0;text-align:center;color:#aab0bb;line-height:1.55}.bar{height:8px;background:#242934;border-radius:999px;overflow:hidden;margin-top:25px}.fill{height:100%;width:0;background:linear-gradient(90deg,#f4f5f7,#9098a6);transition:width .25s ease}' +
    '.pct{text-align:right;color:#8f97a4;font-size:11px;margin-top:7px}.status{margin-top:19px;padding:11px 13px;background:#0a0c10;border:1px solid #20242c;border-radius:11px;font-size:12px;color:#cbd0d8}' +
    '.label{color:#737b89}.path{margin-top:13px;font-size:10px;color:#656d79;word-break:break-all;text-align:center}.error{color:#ffb6b6;text-align:left;white-space:pre-wrap;background:#160e10;border:1px solid #4c2429;border-radius:11px;padding:12px;margin-top:16px;font-size:12px}.hidden{display:none}@keyframes spin{to{transform:rotate(360deg)}}</style>' +
    '</head><body><main><div class="brand">VIDEO HUB</div><div class="sub">Desktop startup diagnostics</div>' +
    '<div id="ring" class="ring"></div><h1 id="status">Starting Video Hub...</h1><p id="detail">Initializing desktop application.</p>' +
    '<div class="bar"><div id="fill" class="fill"></div></div><div id="pct" class="pct">0%</div>' +
    '<div class="status"><span class="label">Status:</span> <span id="status2">Booting</span></div>' +
    '<div class="path">Log: ' + logFile + '<br>Bootstrap log: ' + bootstrapFile + '</div><div id="error" class="error hidden"></div>' +
    '</main><script>' +
    'window.__videoHubSetStatus=function(message,detail,progress,status2){document.getElementById("status").textContent=message||"";document.getElementById("detail").textContent=detail||"";document.getElementById("fill").style.width=Math.max(0,Math.min(100,Number(progress)||0))+"%";document.getElementById("pct").textContent=Math.round(Number(progress)||0)+"%";document.getElementById("status2").textContent=status2||message||"";};' +
    'window.__videoHubShowError=function(message){document.getElementById("ring").style.display="none";document.getElementById("error").classList.remove("hidden");document.getElementById("error").textContent=message||"Unknown startup error";};' +
    '</script></body></html>';
}

function startupErrorHtml(errorMessage) {
  const safe = String(errorMessage).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const pathText = String(logPath()).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const bootstrapText = String(bootstrapLogPath()).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  return '<!doctype html><html><head><meta charset="utf-8"><title>Video Hub startup error</title><style>' +
    'body{margin:0;background:#08090b;color:#f5f6f8;font-family:"Segoe UI",system-ui,sans-serif;padding:48px}main{max-width:920px;margin:auto;background:#121419;border:1px solid #292c34;border-radius:18px;padding:28px}h1{margin:0 0 12px}p{color:#aeb2bd;line-height:1.6}pre{white-space:pre-wrap;background:#0b0c0f;border:1px solid #3a2227;border-radius:10px;padding:14px;color:#ffb4b4}code{word-break:break-all;color:#d8dde6}</style></head>' +
    '<body><main><h1>Video Hub could not finish loading</h1><p>The application started, but startup did not complete. The diagnostic logs below contain the exact failure stage.</p>' +
    '<pre>' + safe + '</pre><p>Application log:<br><code>' + pathText + '</code></p><p>Bootstrap/Chromium log:<br><code>' + bootstrapText + '</code></p></main></body></html>';
}

async function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;
  splashWindow = new BrowserWindow({
    width: 720, height: 470, minWidth: 620, minHeight: 420, resizable: false, maximizable: false, fullscreenable: false,
    movable: true, show: true, frame: false, backgroundColor: '#07080a', title: 'Video Hub', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.on('closed', () => { splashWindow = null; });
  await splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(startupLoadingHtml()));
  splashWindow.show();
  splashWindow.focus();
  log('[startup] splash window shown');
  return splashWindow;
}

async function setSplashStatus(message, detail, progress, status2) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  try {
    await splashWindow.webContents.executeJavaScript(
      'window.__videoHubSetStatus(' + JSON.stringify(message) + ',' + JSON.stringify(detail || '') + ',' + JSON.stringify(progress) + ',' + JSON.stringify(status2 || message) + ')',
      true
    );
  } catch (err) { log('[splash-status]', err?.message || err); }
}

async function showSplashError(error) {
  try {
    await setSplashStatus('Startup stopped', 'Video Hub could not complete startup.', 100, 'ERROR');
    if (splashWindow && !splashWindow.isDestroyed()) {
      await splashWindow.webContents.executeJavaScript('window.__videoHubShowError(' + JSON.stringify(String(error)) + ')', true);
      splashWindow.show();
      splashWindow.focus();
      return;
    }
  } catch (renderError) { log('[splash-error-render]', renderError); }
  try {
    const errorWindow = new BrowserWindow({ width: 980, height: 680, minWidth: 720, minHeight: 520, backgroundColor: '#08090b', autoHideMenuBar: true, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await errorWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(startupErrorHtml(error)));
  } catch (fallbackError) { bootstrapLog('[startup-error-window-failed]', fallbackError); }
}

let updater = null;
let updateInterval = null;
const updateState = {
  status: 'idle',
  currentVersion: null,
  availableVersion: null,
  percent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0,
  error: null,
  checkedAt: null,
  configured: false,
  channel: 'stable',
  readyToInstall: false,
};

function snapshotUpdateState() {
  return { ...updateState };
}

function broadcastUpdateState() {
  const state = snapshotUpdateState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('update:state', state); } catch (err) { log('[updater:send]', err?.message || err); }
  }
}

function setUpdateState(patch) {
  Object.assign(updateState, patch, { currentVersion: app.getVersion() });
  broadcastUpdateState();
}

async function createAutoUpdater() {
  if (!app.isPackaged) {
    setUpdateState({ status: 'development', configured: false, checkedAt: new Date().toISOString() });
    return;
  }
  if (updater) return;
  const config = getUpdateConfig();
  setUpdateState({ configured: config.configured, channel: config.channel, currentVersion: app.getVersion() });
  if (!config.configured) {
    setUpdateState({ status: 'unconfigured', checkedAt: null });
    log('[updater] update channel is not configured');
    return;
  }

  try {
    const { NsisUpdater } = require('electron-updater');
    updater = new NsisUpdater({ provider: 'generic', url: config.url });
    updater.autoDownload = true;
    updater.autoInstallEvent = 'onNextLaunch';
    updater.allowDowngrade = false;
    updater.autoRunAppAfterInstall = true;
    if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;
    updater.logger = {
      info: (...args) => log('[updater]', ...args),
      warn: (...args) => log('[updater:warn]', ...args),
      error: (...args) => log('[updater:error]', ...args),
      debug: (...args) => log('[updater:debug]', ...args),
    };

    updater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null, readyToInstall: false }));
    updater.on('update-available', info => {
      log('[updater] update available', { version: info.version });
      setUpdateState({ status: 'downloading', availableVersion: info.version, percent: 0, error: null, readyToInstall: false });
    });
    updater.on('update-not-available', info => {
      setUpdateState({ status: 'up-to-date', availableVersion: info?.version || null, percent: 0, error: null, readyToInstall: false, checkedAt: new Date().toISOString() });
    });
    updater.on('download-progress', progress => {
      setUpdateState({ status: 'downloading', percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)), transferredBytes: Number(progress.transferred) || 0, totalBytes: Number(progress.total) || 0, bytesPerSecond: Number(progress.bytesPerSecond) || 0 });
    });
    updater.on('update-downloaded', info => {
      log('[updater] update downloaded', { version: info.version });
      setUpdateState({ status: 'ready', availableVersion: info.version, percent: 100, error: null, readyToInstall: true, checkedAt: new Date().toISOString() });
    });
    updater.on('error', error => {
      log('[updater] error', error?.stack || error);
      setUpdateState({ status: 'error', error: error?.message || String(error), checkedAt: new Date().toISOString() });
    });
    log('[updater] initialized', { provider: config.provider, url: config.url, currentVersion: app.getVersion() });

    try {
      if (typeof updater.installPendingUpdateIfAvailable === 'function') {
        await updater.installPendingUpdateIfAvailable();
      }
    } catch (error) {
      log('[updater] pending install check failed', error?.stack || error);
    }
  } catch (error) {
    log('[updater] initialization failed', error?.stack || error);
    setUpdateState({ status: 'error', error: error?.message || String(error), checkedAt: new Date().toISOString() });
  }
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    setUpdateState({ status: 'development', checkedAt: new Date().toISOString() });
    return snapshotUpdateState();
  }
  if (!updater) await createAutoUpdater();
  if (!updater) return snapshotUpdateState();
  try {
    setUpdateState({ status: 'checking', error: null, checkedAt: new Date().toISOString() });
    await updater.checkForUpdates();
  } catch (error) {
    log('[updater] check failed', error?.stack || error);
    setUpdateState({ status: 'error', error: error?.message || String(error), checkedAt: new Date().toISOString() });
  }
  return snapshotUpdateState();
}

async function installUpdateNow() {
  if (!updater || !updateState.readyToInstall) return { ...snapshotUpdateState(), installed: false };
  setUpdateState({ status: 'installing' });
  updater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
  return { ...snapshotUpdateState(), installed: true };
}

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('update:get-state', () => snapshotUpdateState());
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', () => installUpdateNow());
ipcMain.handle('update:open-log', () => {
  shell.openPath(logPath()).catch(error => log('[updater] open-log failed', error));
  return logPath();
});

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 700, backgroundColor: '#0b0b0f', autoHideMenuBar: true, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) log('[renderer] did-fail-load', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => log('[renderer] render-process-gone', details));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) log('[renderer-console]', message, 'at ' + sourceId + ':' + line);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

async function loadAppPage({ validateUi = true } = {}) {
  const window = createMainWindow();
  await setSplashStatus('Loading Video Hub...', 'Connecting to local service on port ' + PORT + '.', 86, 'STARTING UI');
  await waitForServer('http://127.0.0.1:' + PORT + '/api/health', 60000);
  await window.loadURL('http://127.0.0.1:' + PORT + '/');
  if (validateUi) {
    const bodyText = await window.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 5000) : ""', true);
    if (!bodyText || bodyText.trim().length < 10) throw new Error('Renderer loaded an empty page');
    const styleState = await window.webContents.executeJavaScript('JSON.stringify({styleSheets:document.styleSheets.length,bodyFont:getComputedStyle(document.body).fontFamily,bodyBg:getComputedStyle(document.body).backgroundColor})', true);
    log('[renderer] UI loaded', bodyText.slice(0, 120).replace(/\s+/g, ' '), '[styles]', styleState);
    const styles = JSON.parse(styleState || '{}');
    if (!styles.styleSheets || styles.styleSheets < 1) throw new Error('Renderer loaded without any stylesheet. Next static CSS assets may be missing.');
  }
}

async function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  try { splashWindow.close(); } catch {}
  splashWindow = null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  bootstrapLog('[startup] another Video Hub instance is already running');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('[startup] second instance requested focus');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
      splashWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const smokeHttp = process.argv.includes('--smoke-test');
    const smokeUi = process.argv.includes('--smoke-test-ui');
    try {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      userData = app.getPath('userData');
      fs.mkdirSync(userData, { recursive: true });
      log('[startup] app ready', { userData, packaged: app.isPackaged, version: app.getVersion() });
      await createAutoUpdater();

      if (!smokeHttp) {
        await createSplashWindow();
        await setSplashStatus('Starting Video Hub...', 'Preparing the local database.', 12, 'DATABASE');
      }

      await runDatabaseBootstrap();
      await setSplashStatus('Database ready', 'Starting the local media service.', 40, 'DATABASE OK');
      PORT = await choosePort();
      await setSplashStatus('Starting local service...', 'Launching Video Hub on port ' + PORT + '.', 58, 'SERVER');
      startServer();

      if (smokeHttp) {
        await waitForServer('http://127.0.0.1:' + PORT + '/api/health', 30000);
        await runSmokeTest();
        log('SMOKE TEST PASSED');
        stopServer();
        app.quit();
        return;
      }

      await setSplashStatus('Local service ready', 'Loading the Video Hub interface.', 78, 'SERVER OK');
      await loadAppPage({ validateUi: true });
      await setSplashStatus('Ready', 'Video Hub is ready.', 100, 'READY');

      if (smokeUi) {
        await new Promise(resolve => setTimeout(resolve, 350));
        const title = await mainWindow.webContents.getTitle();
        const bodyText = await mainWindow.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 5000) : ""', true);
        if (!bodyText || bodyText.trim().length < 10) throw new Error('UI smoke test found an empty renderer');
        log('UI SMOKE TEST PASSED', title, bodyText.slice(0, 160).replace(/\s+/g, ' '));
        stopServer();
        await closeSplash();
        app.quit();
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
      if (app.isPackaged && updater) {
        setTimeout(() => checkForUpdates().catch(error => log('[updater] startup check failed', error)), 20000);
        updateInterval = setInterval(() => checkForUpdates().catch(error => log('[updater] periodic check failed', error)), 6 * 60 * 60 * 1000);
      }
      await closeSplash();
      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createMainWindow().loadURL('http://127.0.0.1:' + PORT + '/');
      });
    } catch (err) {
      log('[startup-failed]', err?.stack || err);
      if (smokeHttp || smokeUi) {
        stopServer();
        app.exit(1);
        return;
      }
      await showSplashError(err?.message || err);
    }
  }).catch(async err => {
    bootstrapLog('[app-whenReady-failed]', err);
    await showSplashError(err?.message || err);
  });

  app.on('render-process-gone', (_event, _webContents, details) => log('[app] render-process-gone', details));
  app.on('child-process-gone', (_event, details) => log('[app] child-process-gone', details));
  app.on('browser-window-created', (_event, window) => log('[app] browser-window-created', { id: window.id }));
  app.on('window-all-closed', () => { stopServer(); if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (updateInterval) clearInterval(updateInterval); stopServer(); });
}