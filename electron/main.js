// Electron 外壳：在本机启动 Next.js standalone 服务（含代理/搜索等 API），再用窗口加载它。
const { app, BrowserWindow, utilityProcess, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 固定端口：IndexedDB/localStorage 按 origin 存储，端口变了历史和源配置就"丢"了
const PORT = 47654;
const URL = `http://127.0.0.1:${PORT}`;

let server;
let win;

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function startServer() {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  const serverDir = app.isPackaged ? path.join(root, 'server') : path.join(root, '.next', 'standalone');
  // 打包版的 app.env 在 Resources 里；用户数据目录下的 app.env 优先，方便不重新打包就改密码/预置源
  const env = {
    ...readEnvFile(path.join(app.isPackaged ? root : __dirname, 'app.env')),
    ...readEnvFile(path.join(app.getPath('userData'), 'app.env')),
  };
  server = utilityProcess.fork(path.join(serverDir, 'server.js'), [], {
    cwd: serverDir,
    env: {
      ...process.env,
      ...env,
      // 片头片尾识别用的 ffmpeg：打包版在 Resources，开发时用 scripts/fetch-ffmpeg.mjs 下载的
      FFMPEG_PATH: app.isPackaged ? path.join(root, 'ffmpeg') : path.join(root, 'vendor', `ffmpeg-${process.arch}`),
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: 'inherit',
  });
  server.on('exit', (code) => {
    if (!app.isQuitting) {
      dialog.showErrorBox('LibreTV', `本地服务已退出（code ${code}）。端口 ${PORT} 可能被占用。`);
      app.quit();
    }
  });
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${URL}/api/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('本地服务启动超时');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    title: 'LibreTV',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // 窗口标题固定为 LibreTV，不跟随网页 <title>
  win.on('page-title-updated', (e) => e.preventDefault());
  // 站外链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) shell.openExternal(url);
    return { action: url.startsWith(URL) ? 'allow' : 'deny' };
  });
  win.loadURL(URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    startServer();
    try {
      await waitForServer();
    } catch (e) {
      dialog.showErrorBox('LibreTV', String(e.message || e));
      app.quit();
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    server?.kill();
  });
  // macOS 习惯：关窗不退出，点 Dock 图标再打开
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
