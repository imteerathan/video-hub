const { app, BrowserWindow, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

let PORT = Number(process.env.VIDEO_HUB_PORT || 3187);
let serverProcess = null;
let mainWindow = null;
let serverRoot = null;
let userData = null;

function logPath() {
  return path.join(app.getPath('userData'), 'video-hub-desktop.log');
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(logPath(), line); } catch {}
  console.log(...args);
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

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error(`Video Hub server did not start in time: ${url}`));
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
  const env = { ...process.env, DATABASE_URL: `file:${dbPath}`, ELECTRON_RUN_AS_NODE: '1' };
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'db', 'push', '--schema', path.join(root, 'prisma', 'schema.prisma'), '--skip-generate'], {
      cwd: root, env, stdio: 'pipe', windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); log('[prisma:err]', d.toString().trim()); });
    child.stdout.on('data', d => log('[prisma]', d.toString().trim()));
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Prisma database bootstrap failed (${code}): ${stderr}`)));
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
    DATABASE_URL: `file:${dbPath}`,
    ELECTRON_RUN_AS_NODE: '1',
  };

  serverRoot = root;
  const server = path.join(root, '.next', 'standalone', 'server.js');
  serverProcess = spawn(process.execPath, [server], { cwd: root, env, stdio: 'pipe', windowsHide: true });
  serverProcess.on('error', err => log('[video-hub] server error', err.message));
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
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout: ${url}`)));
  });
}

async function runSmokeTest() {
  const health = await httpGet(`http://127.0.0.1:${PORT}/api/health`);
  if (health.statusCode !== 200 || !health.body.includes('"ok":true')) {
    throw new Error(`Health check failed: HTTP ${health.statusCode} ${health.body}`);
  }
  const home = await httpGet(`http://127.0.0.1:${PORT}/`);
  if (home.statusCode !== 200 || !home.body.includes('VIDEO HUB')) {
    throw new Error(`Home page check failed: HTTP ${home.statusCode}`);
  }
  log('HTTP smoke test passed');
}

function startupErrorHtml(errorMessage) {
  const safe = String(errorMessage)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const pathText = String(logPath())
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Video Hub startup error</title>
  <style>body{margin:0;background:#08090b;color:#f5f6f8;font-family:Segoe UI,system-ui,sans-serif;padding:48px}
  main{max-width:900px;margin:auto;background:#121419;border:1px solid #292c34;border-radius:18px;padding:28px}
  h1{margin:0 0 12px}p{color:#aeb2bd;line-height:1.6}pre{white-space:pre-wrap;background:#0b0c0f;border:1px solid #252830;border-radius:10px;padding:14px;color:#ffb4b4}
  code{word-break:break-all}</style></head><body><main><h1>Video Hub could not finish loading</h1>
  <p>The app started, but the local Video Hub page did not finish loading.</p><pre>${safe}</pre>
  <p>Diagnostic log: <code>${pathText}</code></p></main></body></html>`;
}

async function showStartupError(error) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 980,
      height: 680,
      minWidth: 720,
      minHeight: 520,
      backgroundColor: '#08090b',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  }
  try {
    await mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(startupErrorHtml(error)));
  } catch (fallbackError) {
    log('[startup-error-window-failed]', fallbackError?.stack || fallbackError);
  }
}

async function createWindow({ validateUi = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await waitForServer(`http://127.0.0.1:${PORT}/api/health`);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) log('[renderer] did-fail-load', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('[renderer] render-process-gone', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) log('[renderer-console]', message, `at ${sourceId}:${line}`);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  if (validateUi) {
    const bodyText = await mainWindow.webContents.executeJavaScript(
      'document.body ? document.body.innerText.slice(0, 5000) : ""',
      true
    );
    if (!bodyText || bodyText.trim().length < 10) {
      throw new Error('Renderer loaded an empty page');
    }
    log('[renderer] UI loaded', bodyText.slice(0, 120).replace(/\s+/g, ' '));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) log('[renderer] did-fail-load', errorCode, errorDescription, validatedURL);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('[renderer] render-process-gone', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) log('[renderer-console]', message, `at ${sourceId}:${line}`);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  if (validateUi) {
    const bodyText = await mainWindow.webContents.executeJavaScript(
      'document.body ? document.body.innerText.slice(0, 5000) : ""',
      true
    );
    if (!bodyText || bodyText.trim().length < 10) {
      throw new Error('Renderer loaded an empty page');
    }
    log('[renderer] UI loaded', bodyText.slice(0, 120).replace(/\s+/g, ' '));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  process.on('uncaughtException', err => log('[uncaughtException]', err.stack || err.message));
  process.on('unhandledRejection', err => log('[unhandledRejection]', err?.stack || err));

  app.whenReady().then(async () => {
    try {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      await runDatabaseBootstrap();
      PORT = await choosePort();
      startServer();
      await waitForServer(`http://127.0.0.1:${PORT}/api/health`);

      if (process.argv.includes('--smoke-test')) {
        await runSmokeTest();
        log('SMOKE TEST PASSED');
        stopServer();
        app.quit();
        return;
      }

      const smokeUi = process.argv.includes('--smoke-test-ui');
      try {
        await createWindow({ validateUi: true });
        if (smokeUi) {
          await new Promise(resolve => setTimeout(resolve, 350));
          const title = await mainWindow.webContents.getTitle();
          const bodyText = await mainWindow.webContents.executeJavaScript(
            'document.body ? document.body.innerText.slice(0, 5000) : ""',
            true
          );
          if (!bodyText || bodyText.trim().length < 10) throw new Error('UI smoke test found an empty renderer');
          log('UI SMOKE TEST PASSED', title, bodyText.slice(0, 160).replace(/\s+/g, ' '));
          stopServer();
          app.quit();
          return;
        }
      } catch (err) {
        log('[renderer-startup-failed]', err?.stack || err);
        await showStartupError(err?.message || err);
        return;
      }
      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
      });
    } catch (err) {
      log('[startup-failed]', err?.stack || err);
      await showStartupError(err?.message || err);
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', stopServer);
}
