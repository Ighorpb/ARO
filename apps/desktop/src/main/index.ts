import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import path from "node:path";

const VOICE_HOTKEY = "CommandOrControl+Shift+Space";
const TOGGLE_HOTKEY = "CommandOrControl+Shift+A";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let compact = true; // nasce minimalista
let ignoringMouse = false;

/**
 * A janela ocupa a área útil inteira, sempre, transparente. Quem muda de tamanho é o orb
 * (CSS transform no renderer) — animar bounds de janela no Windows fica travado.
 * No modo minimalista a janela vira click-through fora do orb.
 */
function fullBounds(): Electron.Rectangle {
  return screen.getPrimaryDisplay().workArea;
}

function setIgnoreMouse(ignore: boolean) {
  if (!win || ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  // forward: true → o renderer continua recebendo mousemove pra saber quando o cursor entra no orb
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function setCompact(next: boolean) {
  if (!win || next === compact) return;
  compact = next;
  win.webContents.send("window:compact", compact);
  if (!compact) setIgnoreMouse(false);
  refreshTray();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else {
    win.show();
    win.focus();
  }
}

function loginEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setLogin(enabled: boolean) {
  // start.cmd na raiz do repo sobe core + desktop + voz
  const script = path.resolve(app.getAppPath(), "../../start.cmd");
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: "cmd.exe",
    args: ["/c", "start", '"ARO"', "/min", `"${script}"`],
  });
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win?.isVisible() ? "Esconder" : "Mostrar", click: toggleVisible },
      { label: "Modo minimalista", type: "checkbox", checked: compact, click: () => setCompact(!compact) },
      { type: "separator" },
      { label: "Iniciar com o Windows", type: "checkbox", checked: loginEnabled(), click: () => setLogin(!loginEnabled()) },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), "resources", "tray.png"));
  tray = new Tray(icon);
  tray.setToolTip("ARO");
  tray.on("click", toggleVisible);
  refreshTray();
}

function createWindow() {
  win = new BrowserWindow({
    ...fullBounds(),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win?.show();
    if (compact) setIgnoreMouse(true);
  });

  // fechar esconde na bandeja; "Sair" fica no menu da bandeja
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    refreshTray();
  });
  win.on("show", refreshTray);
  win.on("hide", refreshTray);

  // monitor mudou (resolução, barra de tarefas) → reencaixa
  screen.on("display-metrics-changed", () => win?.setBounds(fullBounds()));

  // Links externos abrem no navegador, não dentro do ARO
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // ARO_HUB_URL permite apontar pra outro hub (ex: mock em outra porta)
  const hub = process.env.ARO_HUB_URL;
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (hub) url.searchParams.set("hub", hub);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"), hub ? { query: { hub } } : undefined);
  }
}

ipcMain.handle("window:minimize", () => win?.minimize());
ipcMain.handle("window:close", () => win?.close());
ipcMain.handle("window:togglePin", () => {
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return next;
});
ipcMain.handle("window:isPinned", () => win?.isAlwaysOnTop() ?? false);
ipcMain.handle("window:setCompact", (_e, next: boolean) => setCompact(next));
ipcMain.handle("window:isCompact", () => compact);
/** Print do monitor principal, sem o próprio ARO (contentProtection tira a janela da captura). */
async function captureScreen(): Promise<string> {
  if (!win) throw new Error("sem janela");
  const display = screen.getPrimaryDisplay();
  const scale = 1568 / display.size.width;
  const thumbnailSize = { width: 1568, height: Math.round(display.size.height * scale) };
  win.setContentProtection(true);
  try {
    await new Promise((r) => setTimeout(r, 120)); // dá tempo do compositor aplicar
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error("nenhuma tela encontrada");
    return source.thumbnail.toJPEG(78).toString("base64");
  } finally {
    win.setContentProtection(false);
  }
}

ipcMain.handle("screen:capture", () => captureScreen());
ipcMain.handle("clipboard:read", () => clipboard.readText());

// renderer avisa quando o cursor entra/sai do orb no modo minimalista
ipcMain.handle("window:setIgnoreMouse", (_e, ignore: boolean) => {
  if (compact) setIgnoreMouse(ignore);
});

app.setAppUserModelId("dev.ighor.aro");

// instância única — exceto em teste apontando pra outro hub
if (!process.env.ARO_HUB_URL && !app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (!globalShortcut.register(VOICE_HOTKEY, () => win?.webContents.send("voice:toggle"))) {
    console.warn(`[aro] não consegui registrar o atalho ${VOICE_HOTKEY}`);
  }
  if (!globalShortcut.register(TOGGLE_HOTKEY, toggleVisible)) {
    console.warn(`[aro] não consegui registrar o atalho ${TOGGLE_HOTKEY}`);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  // com bandeja, a janela some mas o app continua
});
