// Electron shell around the existing Express dashboard (app/server.mjs).
// The dashboard itself is untouched — this just gives it a real desktop
// window/icon instead of relying on the OS's default browser, and tells the
// server (via JOB_DIGEST_ELECTRON) to store user config in Electron's
// userData directory instead of next to the app code, since a packaged
// install directory may not be writable (see app/lib/config.mjs).
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');

const PORT = process.env.PORT || 4317;
const SERVER_URL = `http://localhost:${PORT}`;

// Scheduled digest runs are driven by the same in-process server the window
// displays (app/lib/scheduler.mjs polls on an interval). If closing the
// window quit the whole app, "runs on its own schedule" would only be true
// while the window happened to be open. Instead the window close button just
// hides it; the app — and its scheduler — keeps running via the tray icon
// until the user explicitly chooses Quit.
let win = null;
let tray = null;
let isQuitting = false;

// Only one copy of the server should ever bind the port. Without this, a
// second launch while the app is already resident in the tray (e.g. the
// user double-clicks the Start Menu shortcut again) would crash trying to
// listen on an in-use port instead of just surfacing the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    process.env.JOB_DIGEST_ELECTRON = '1';
    process.env.JOB_DIGEST_USER_DATA_DIR = app.getPath('userData');
    // app/server.mjs self-starts (app.listen(...)) the moment it's imported —
    // reused exactly as the source/dev path runs it, no rewrite.
    import('../app/server.mjs');
    createWindow();
    createTray();

    app.on('activate', () => {
      if (win) win.show();
      else createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  // Intentionally not quitting here: the window-close handler below hides
  // rather than closes the window, so this normally only fires after Quit
  // (from the tray menu) has already set isQuitting — nothing left to do.
  app.on('window-all-closed', () => {});
}

function waitForServer(url, { retries = 60, delayMs = 250 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      require('node:http')
        .get(url, (res) => {
          res.destroy();
          resolve();
        })
        .on('error', () => {
          if (remaining <= 0) return reject(new Error(`Server did not start at ${url}`));
          setTimeout(() => attempt(remaining - 1), delayMs);
        });
    };
    attempt(retries);
  });
}

async function createWindow() {
  await waitForServer(SERVER_URL);
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Job Digest',
    autoHideMenuBar: true,
  });
  win.loadURL(SERVER_URL);

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

// A flat placeholder square, generated at runtime so no binary icon asset
// has to be committed to the repo. Fine for a tray glyph; swap for a real
// app icon (.ico/.icns, wired into package.json's build.win/mac.icon) when
// the project has real branding to package.
function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buffer[i * 4] = 0x72; // R
    buffer[i * 4 + 1] = 0x4a; // G
    buffer[i * 4 + 2] = 0x8f; // B
    buffer[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Job Digest');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Job Digest',
        click: () => {
          if (win) win.show();
          else createWindow();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => {
    if (win) win.show();
  });
}
