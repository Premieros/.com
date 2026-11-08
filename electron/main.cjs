// Premier Print Agent - Windows desktop shell and local thermal print bridge.
// Every physical printer owns an independent FIFO queue and hidden print worker.

const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { PerPrinterQueue, withTimeout } = require('./printerQueue.cjs');
const { startLocalAppServer } = require('./localAppServer.cjs');
const { openLocalDraftJournal } = require('./localDraftJournal.cjs');
const { createDesktopUpdateManager, policyIsApproved } = require('./desktopUpdateManager.cjs');
const { inspectDesktopExitSafety } = require('./desktopExitSafety.cjs');
const desktopUpdatePolicy = require('./desktop-update-policy.json');

const DEFAULT_THERMAL_WIDTH_MM = 80;
const PRINT_LOAD_TIMEOUT_MS = 6000;
const PRINT_CALLBACK_TIMEOUT_MS = 12000;

let mainWindow = null;
let allowQuit = false;
let localAppServer = null;
let desktopTray = null;
let updateManager = null;
const printerQueue = new PerPrinterQueue();
const printWorkerWindows = new Map();


function workerKey(printerName) {
  return String(printerName || '').trim().toLocaleLowerCase();
}

function destroyPrintWorker(printerName) {
  const key = workerKey(printerName);
  const worker = printWorkerWindows.get(key);
  if (worker && !worker.isDestroyed()) worker.destroy();
  printWorkerWindows.delete(key);
}

function destroyAllPrintWorkers() {
  for (const worker of printWorkerWindows.values()) {
    if (worker && !worker.isDestroyed()) worker.destroy();
  }
  printWorkerWindows.clear();
  printerQueue.clear();
}

function createPrintWorker(printerName) {
  const key = workerKey(printerName);
  const existing = printWorkerWindows.get(key);
  if (existing && !existing.isDestroyed()) return existing;

  const worker = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  printWorkerWindows.set(key, worker);
  worker.on('closed', () => {
    if (printWorkerWindows.get(key) === worker) printWorkerWindows.delete(key);
  });
  return worker;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeThermalWidthMm(value) {
  const width = Number(value);
  return width === 58 ? 58 : DEFAULT_THERMAL_WIDTH_MM;
}

function thermalCss(widthMm) {
  return `
<style id="premier-thermal-page">
  @page { margin: 0; }
  html, body {
    width: ${widthMm}mm !important;
    min-width: ${widthMm}mm !important;
    max-width: ${widthMm}mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    overflow: visible !important;
  }
  body { box-sizing: border-box !important; }
  *, *::before, *::after { box-sizing: border-box; }
</style>`;
}

function applyThermalLayout(html, widthMm) {
  const css = thermalCss(widthMm);
  const title = '<title>Premier POS Thermal</title>';
  let normalized = String(html || '');
  if (/<head[\s>]/i.test(normalized)) {
    normalized = normalized.replace(/<head([^>]*)>/i, `<head$1>${title}${css}`);
  } else if (/<html[\s>]/i.test(normalized)) {
    normalized = normalized.replace(/<html([^>]*)>/i, `<html$1><head>${title}${css}</head>`);
  } else {
    normalized = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${title}${css}</head><body>${normalized}</body></html>`;
  }
  return normalized;
}

function textToPrintableHtml(text, widthMm) {
  const safe = escapeHtml(text);
  return applyThermalLayout(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
  pre {
    width: 100%;
    margin: 0;
    padding: 2mm;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    direction: rtl;
    text-align: right;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.3;
  }
</style>
</head>
<body><pre>${safe}</pre></body>
</html>`, widthMm);
}

function driverCompatiblePrintOptions(printerName, options) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerName,
    copies: options.copies,
    margins: { marginType: 'none' },
  };
}

function minimalDriverPrintOptions(printerName) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerName,
  };
}

async function printOnPhysicalPrinter(printerName, options) {
  const worker = createPrintWorker(printerName);
  const printableHtml = options.html
    ? applyThermalLayout(options.html, options.paperWidthMm)
    : textToPrintableHtml(options.text, options.paperWidthMm);

  const attemptPrint = (printOptions) => withTimeout(new Promise((resolve) => {
    worker.webContents.print(
      printOptions,
      (success, failureReason) => {
        resolve(success
          ? { success: true, printerName }
          : { success: false, error: failureReason || 'PRINT_FAILED' });
      },
    );
  }), PRINT_CALLBACK_TIMEOUT_MS, 'PRINT_CALLBACK_TIMEOUT');

  try {
    await withTimeout(
      worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`),
      PRINT_LOAD_TIMEOUT_MS,
      'PRINT_LOAD_TIMEOUT',
    );

    let result = await attemptPrint(driverCompatiblePrintOptions(printerName, options));
    if (!result.success && /invalid printer settings/i.test(String(result.error || ''))) {
      result = await attemptPrint(minimalDriverPrintOptions(printerName));
      if (!result.success) {
        result.error = `INVALID_PRINTER_SETTINGS: ${result.error || 'PRINT_FAILED'}`;
      }
    }

    if (!result.success) destroyPrintWorker(printerName);
    return result;
  } catch (error) {
    destroyPrintWorker(printerName);
    throw error;
  }
}

async function createWindow() {
  // Electron always serves the UI bundled in its own installer. No remote
  // startup URL, web fallback, or silently substituted application version.
  if (!localAppServer) {
    localAppServer = await startLocalAppServer({
      distDir: path.join(__dirname, '..', 'dist'),
    });
  }
  const targetUrl = localAppServer.url;
  const trustedOrigin = new URL(targetUrl).origin;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Premier Print Agent',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      // Hard boundary: the privileged preload bridge belongs to this exact
      // local origin only, not to a remote or a second local app.
      if (parsed.origin !== trustedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(targetUrl).catch((error) => {
    console.error('[Premier Desktop] Failed to load bundled UI:', error);
    dialog.showErrorBox('Premier OS', 'Bundled application could not be loaded. No remote fallback was used.');
    app.quit();
  });

  mainWindow.on('close', (event) => {
    if (!allowQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('pos:get-printers', async () => {
  try {
    if (!mainWindow) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || '',
      status: printer.status,
      isDefault: printer.isDefault,
    }));
  } catch (error) {
    console.error('[Printer] Failed to enumerate printers:', error);
    return [];
  }
});

ipcMain.handle('pos:print-silent', async (_event, options = {}) => {
  const printerName = typeof options.printerName === 'string' ? options.printerName.trim() : '';
  const html = typeof options.html === 'string' ? options.html : '';
  const text = typeof options.text === 'string' ? options.text : '';
  const copies = Math.max(1, Math.min(5, Number(options.copies || 1)));
  const paperWidthMm = normalizeThermalWidthMm(options.paperWidthMm);

  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };
  if (!html && !text) return { success: false, error: 'NO_CONTENT_TO_PRINT' };

  try {
    if (!mainWindow) return { success: false, error: 'AGENT_WINDOW_UNAVAILABLE' };
    const availablePrinters = await mainWindow.webContents.getPrintersAsync();
    if (!availablePrinters.some((printer) => printer.name === printerName)) {
      return { success: false, error: `PRINTER_NOT_FOUND: ${printerName}` };
    }

    return await printerQueue.enqueue(printerName, () => printOnPhysicalPrinter(printerName, {
      html,
      text,
      copies,
      paperWidthMm,
    }));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'PRINT_ERROR' };
  }
});

ipcMain.handle('pos:kick-drawer', async (_event, requestedPrinterName) => {
  const printerName = typeof requestedPrinterName === 'string' ? requestedPrinterName.trim() : '';
  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };

  const tempFile = path.join(os.tmpdir(), `premier-drawer-${Date.now()}.bin`);
  fs.writeFileSync(tempFile, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));

  return await new Promise((resolve) => {
    const script = '$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Encoding Byte -Raw | Out-Printer -Name $p';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, printerName, tempFile],
      { windowsHide: true, timeout: PRINT_CALLBACK_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
        resolve(error ? { success: false, error: String(stderr || error.message || '').trim() } : { success: true });
      },
    );
  });
});

// Read-only OS-encryption diagnostics. This never stages, posts, retries,
// restores or synchronizes a financial document. A local privileged UI alone
// can inspect its own draft storage readiness.
ipcMain.handle('desktop:get-local-draft-health', async (event) => {
  const unavailable = (code) => ({
    ready: false, mode: 'DRAFT_ONLY', canPost: false, canSync: false,
    error: code,
  });
  if (!localAppServer || !mainWindow || event.sender !== mainWindow.webContents) {
    return unavailable('LOCAL_DRAFT_DIAGNOSTIC_UNAUTHORIZED');
  }
  try {
    const senderOrigin = new URL(event.senderFrame?.url || event.sender.getURL()).origin;
    if (senderOrigin !== new URL(localAppServer.url).origin) {
      return unavailable('LOCAL_DRAFT_DIAGNOSTIC_WRONG_ORIGIN');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return unavailable('LOCAL_DRAFT_OS_ENCRYPTION_UNAVAILABLE');
    }
    // The installed Electron userData directory must remain stable across
    // upgrades; do not move this file or guess how to migrate DPAPI secrets.
    const filename = path.join(app.getPath('userData'), 'draft-journal-v1.sqlite');
    const journal = openLocalDraftJournal({ filename, codec: safeStorage });
    try {
      const integrity = journal.verifyIntegrity();
      return {
        ready: true, mode: 'DRAFT_ONLY', canPost: false, canSync: false,
        verifiedDrafts: integrity.verifiedDrafts,
      };
    } finally {
      journal.close();
    }
  } catch (error) {
    console.warn('[Premier Desktop] Draft journal readiness check failed:',
      error instanceof Error ? error.message : 'unknown error');
    return unavailable('LOCAL_DRAFT_STORAGE_UNAVAILABLE');
  }
});

// This read-only status is available only from the bundled Premier origin.
// Update release checks and all install decisions stay inside the main process.
ipcMain.handle('desktop:get-update-status', async (event) => {
  const disabled = { state:'disabled', enabled:false, autoInstallOnExit:false };
  if (!mainWindow || event.sender !== mainWindow.webContents || !localAppServer) return disabled;
  try {
    const origin = new URL(event.senderFrame?.url || event.sender.getURL()).origin;
    if (origin !== new URL(localAppServer.url).origin) return disabled;
    return updateManager?.status() || disabled;
  } catch {
    return disabled;
  }
});

function showDesktopWindow() {
  if (!mainWindow) {
    void createWindow().catch(reportDesktopStartupError);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createDesktopTray() {
  // The X button keeps the print agent alive; "Exit Premier OS" is a real
  // application quit and is the ONLY time a verified downloaded update can install.
  if (desktopTray) return;
  const iconData = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAoElEQVR42mPkF9f6z0BDwIIuwK/ZSpGBH69Xo/CZqGk4NjOYqGk4NrOYqG04uiUshBQ+3B/AwMDAwCDvuAHORgbyjhvw6mcixnB0Ni41JFtALMBnCQuphiEHCSHXU80HA2oBCzXDm2Y+wJdUmWhpOMlBRMiw4ZmKhrkFyJFKTgQzMDAwMMLqZGrXCbCqkwlXXUqtepkJX4VNjUqfkdbNFgB/Di+furTO1wAAAABJRU5ErkJggg==';
  const image = nativeImage.createFromBuffer(Buffer.from(iconData, 'base64'));
  desktopTray = new Tray(image);
  desktopTray.setToolTip('Premier OS');
  desktopTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Premier OS', click: showDesktopWindow },
    { type: 'separator' },
    { label: 'Exit Premier OS', click: () => app.quit() },
  ]));
  desktopTray.on('double-click', showDesktopWindow);
}

function startSignedDesktopUpdates() {
  // The switch stays OFF in draft PRs until a reviewed Windows certificate,
  // matching publisherName and an official signed release have been verified.
  let updater = null;
  if (policyIsApproved(desktopUpdatePolicy) &&
      app.isPackaged && process.platform === 'win32') {
    updater = require('electron-updater').autoUpdater;
  }
  updateManager = createDesktopUpdateManager({
    app,
    updater,
    policy:desktopUpdatePolicy,
    inspectSafeExit: () => inspectDesktopExitSafety({
      mainWindow, localAppUrl:localAppServer?.url,
      printerQueue, app, safeStorage,
    }),
  });
  updateManager.start();
}

ipcMain.handle('pos:get-system-info', async () => ({
  isElectron: true,
  platform: process.platform,
  hostname: os.hostname(),
  arch: process.arch,
  version: app.getVersion(),
}));

function reportDesktopStartupError(error) {
  console.error('[Premier Desktop] Local UI startup failed:', error);
  dialog.showErrorBox(
    'Premier OS - Local startup failed',
    'Cannot start the locally installed interface. Verify the installation and that port 43187 is available. No online application will be substituted.',
  );
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) void createWindow().catch(reportDesktopStartupError);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    }
    try {
      await createWindow();
      createDesktopTray();
      startSignedDesktopUpdates();
    } catch (error) {
      reportDesktopStartupError(error);
      return;
    }
    app.on('activate', () => {
      if (!mainWindow) void createWindow().catch(reportDesktopStartupError);
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

app.on('before-quit', (event) => {
  // An update may delay this real exit briefly to verify that nothing remains
  // unsynced. Do not tear down the browser or printer queue before the check.
  updateManager?.beforeQuit(event);
  if (!event.defaultPrevented) allowQuit = true;
});

app.on('will-quit', () => {
  allowQuit = true;
  updateManager?.stop();
  destroyAllPrintWorkers();
  if (desktopTray) {
    desktopTray.destroy();
    desktopTray = null;
  }
  if (localAppServer) {
    void localAppServer.close().catch((error) =>
      console.warn('[Premier Desktop] Failed to stop local UI server:', error));
    localAppServer = null;
  }
});

app.on('window-all-closed', () => {});
