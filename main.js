// main.js — Win + macOS (tray flyout), full-height panel, snooze-aware reminders
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RES = (p) => path.join(__dirname, p);

const isMac = process.platform === 'darwin';

// ---- layout ----
const PANEL_WIDTH = 420;
const EDGE_MARGIN = 12; // 0 — якщо хочеш edge-to-edge

// ---- globals ----
let panelWin;
let tray;
const tasksStore = new Store({ name: 'tasks' });
const projectsStore = new Store({ name: 'projects' });
app.setAppUserModelId('com.myslennya.taskpanel');

// init default projects if empty
if (!projectsStore.get('items')) projectsStore.set('items', ['personal', 'work']);

// ---- reminders ----
const TICK_MS = 30 * 1000;
let tickTimer;

const getTasks = () => tasksStore.get('tasks', []);
const setTasks = (tasks) => tasksStore.set('tasks', tasks);

function parseDue(task) {
	if (!task?.due) return null;
	const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(task.due);
	const dt = isDateOnly ? new Date(`${task.due}T09:00:00`) : new Date(task.due);
	return isNaN(dt.getTime()) ? null : dt;
}

// Snooze-aware reminder logic
function shouldFire(task, now, mode) {
	if (task.done) return false;

	const due = parseDue(task);

	// If snoozed and we're checking "lead" — fire exactly at snoozedUntil once
	if (mode === 'lead' && task.snoozedUntil) {
		if (task._lastLeadAt && task._lastLeadAt >= task.snoozedUntil) return false;
		return now.getTime() >= task.snoozedUntil;
	}

	// While snooze is in effect, suppress other modes until it elapses
	if (task.snoozedUntil && now.getTime() < task.snoozedUntil) return false;

	if (!due) return false;

	if (mode === 'lead') {
		const lead = (task.remindBeforeMin ?? 10) * 60 * 1000;
		const fireAt = new Date(due.getTime() - lead);
		if (task._lastLeadAt && task._lastLeadAt >= fireAt.getTime()) return false;
		return now.getTime() >= fireAt.getTime() && now.getTime() < due.getTime();
	}
	if (mode === 'due') {
		if (task._lastDueAt) return false;
		return now.getTime() >= due.getTime() && now.getTime() < due.getTime() + TICK_MS;
	}
	if (mode === 'overdue') {
		const backoff = 2 * 60 * 60 * 1000;
		if (now.getTime() < due.getTime()) return false;
		if (!task._lastOverdueAt) return true;
		return now.getTime() - task._lastOverdueAt >= backoff;
	}
	return false;
}

function showNotification(task, kind) {
	const due = parseDue(task);
	const parts = [];
	if (task.project) parts.push(`proj:${task.project}`);
	if (task.tags?.length) parts.push(task.tags.map((t) => `+${t}`).join(' '));
	if (due) parts.push(`due: ${due.toLocaleString()}`);

	const title = kind === 'lead' ? 'Нагадування про задачу' : kind === 'due' ? 'Час виконати задачу' : 'Прострочена задача';

	const n = new Notification({
		title,
		body: `${task.title}\n${parts.join('  ')}`,
		silent: false,
		actions: [
			{ type: 'button', text: 'Готово' },
			{ type: 'button', text: 'Відкласти 10 хв' },
		],
		closeButtonText: 'Закрити',
	});

	n.on('action', (_e, idx) => {
		const tasks = getTasks();
		const t = tasks.find((x) => x.id === task.id);
		if (!t) return;
		if (idx === 0) {
			t.done = true;
			t.snoozedUntil = null;
		}
		if (idx === 1) {
			t.snoozedUntil = Date.now() + 10 * 60 * 1000;
		}
		setTasks(tasks);
	});

	n.on('close', () => {
		const tasks = getTasks();
		const t = tasks.find((x) => x.id === task.id);
		if (!t) return;
		const now = Date.now();
		if (kind === 'lead') {
			t._lastLeadAt = now;
			if (t.snoozedUntil && now >= t.snoozedUntil) t.snoozedUntil = null; // clear snooze after it fires
		}
		if (kind === 'due') t._lastDueAt = now;
		if (kind === 'overdue') t._lastOverdueAt = now;
		setTasks(tasks);
	});

	n.show();
}

function checkDueAndNotify() {
	const now = new Date();
	const tasks = getTasks();
	for (const t of tasks) {
		if (t.remindBeforeMin > 0 && shouldFire(t, now, 'lead')) showNotification(t, 'lead');
		if (shouldFire(t, now, 'due')) showNotification(t, 'due');
		if (shouldFire(t, now, 'overdue')) showNotification(t, 'overdue');
	}
}
function startScheduler() {
	clearInterval(tickTimer);
	tickTimer = setInterval(checkDueAndNotify, TICK_MS);
	checkDueAndNotify();
}

// ---- panel window ----
function getTargetDisplay() {
	const pt = screen.getCursorScreenPoint();
	return screen.getDisplayNearestPoint(pt) || screen.getPrimaryDisplay();
}

// macOS: open under tray icon; Windows: stick to right edge, full workArea height
function positionPanel() {
	const width = PANEL_WIDTH;

	if (isMac && tray) {
		const trayBounds = tray.getBounds(); // {x,y,width,height} in screen coords
		const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
		const { workArea } = display;

		// Height = full workArea (minus margins). Y — трохи нижче менюбара.
		const height = Math.max(200, workArea.height - EDGE_MARGIN * 2);
		const x = Math.round(trayBounds.x + Math.round(trayBounds.width / 2) - Math.round(width / 2));
		const y = Math.round(workArea.y + EDGE_MARGIN);

		panelWin.setBounds({ x, y, width, height });
		return;
	}

	// Windows / Linux
	const { workArea } = getTargetDisplay();
	const height = Math.max(200, workArea.height - EDGE_MARGIN * 2);
	const x = Math.round(workArea.x + workArea.width - width - EDGE_MARGIN);
	const y = Math.round(workArea.y + EDGE_MARGIN);
	panelWin.setBounds({ x, y, width, height });
}

function createPanelWindow() {
	panelWin = new BrowserWindow({
		width: PANEL_WIDTH,
		height: 400,
		frame: false,
		resizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		show: false,
		transparent: true,
		backgroundColor: isMac ? '#00000000' : 'rgba(255,255,255,0)',
		icon: nativeImage.createFromPath(RES('icon.png')),
		webPreferences: {
			preload: RES('preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	// Nice blur on macOS
	if (isMac) {
		try {
			panelWin.setVibrancy('sidebar'); // 'hud' | 'popover' | etc.
			panelWin.setVisualEffectState('active');
		} catch {}
	}

	panelWin.loadFile(RES('index.html'));
	panelWin.on('blur', () => {
		if (panelWin?.isVisible()) panelWin.hide();
	});
}

function togglePanel() {
	if (!panelWin) return;
	if (panelWin.isVisible()) panelWin.hide();
	else {
		positionPanel();
		panelWin.showInactive();
		panelWin.focus();
	}
}

// ---- lifecycle ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		togglePanel();
	});
}

app.whenReady().then(() => {
	// macOS: hide Dock (menubar-style). Safe in dev too.
	if (isMac) {
		try {
			if (app.dock) app.dock.hide();
			// accessory prevents app from appearing as a foreground regular app
			if (app.setActivationPolicy) app.setActivationPolicy('accessory');
		} catch {}
	}

	createPanelWindow();

	// Tray
	try {
		tray = new Tray(nativeImage.createFromPath(RES('icon.png')));
		tray.setToolTip('Task Panel');
		tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open/Close', click: togglePanel }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
		tray.on('click', togglePanel); // mac: click opens under the icon
	} catch (e) {
		console.log('Tray init error:', e);
	}

	// Hotkeys
	// Use CommandOrControl to get Cmd on macOS, Ctrl on Windows
	globalShortcut.register('CommandOrControl+Alt+T', togglePanel);
	// keep the old one too if you like:
	globalShortcut.register('Alt+`', togglePanel);

	screen.on('display-metrics-changed', () => {
		if (panelWin?.isVisible()) positionPanel();
	});

	// Autostart (works on both platforms)
	app.setLoginItemSettings({ openAtLogin: true });

	// IPC: tasks
	ipcMain.handle('tasks:get', () => getTasks());
	ipcMain.handle('tasks:set', (_e, tasks) => {
		setTasks(tasks);
		checkDueAndNotify();
	});

	// IPC: autostart
	ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
	ipcMain.handle('autostart:set', (_e, enabled) => app.setLoginItemSettings({ openAtLogin: !!enabled }));

	// IPC: projects
	ipcMain.handle('projects:get', () => projectsStore.get('items', []));
	ipcMain.handle('projects:set', (_e, items) => projectsStore.set('items', items || []));

	startScheduler();

	setTimeout(() => {
		togglePanel();
	}, 300);
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => globalShortcut.unregisterAll());
