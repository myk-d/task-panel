import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';
import Store from 'electron-store';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RES = (p) => path.join(__dirname, p);

const isMac = process.platform === 'darwin';

const PANEL_WIDTH = 420;
const EDGE_MARGIN = 12;

let panelWin;
let tray;
const tasksStore = new Store({ name: 'tasks' });
const projectsStore = new Store({ name: 'projects' });
app.setAppUserModelId('com.myslennya.taskpanel');

if (!projectsStore.get('items')) projectsStore.set('items', ['personal', 'work']);

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

function shouldFire(task, now, mode) {
	if (task.done) return false;

	const due = parseDue(task);

	if (mode === 'lead' && task.snoozedUntil) {
		if (task._lastLeadAt && task._lastLeadAt >= task.snoozedUntil) return false;
		return now.getTime() >= task.snoozedUntil;
	}

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
			if (t.snoozedUntil && now >= t.snoozedUntil) t.snoozedUntil = null;
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

function getTargetDisplay() {
	const pt = screen.getCursorScreenPoint();
	return screen.getDisplayNearestPoint(pt) || screen.getPrimaryDisplay();
}

function positionPanel() {
	const width = PANEL_WIDTH;

	if (isMac && tray) {
		const trayBounds = tray.getBounds();
		const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
		const { workArea } = display;

		const height = Math.max(200, workArea.height - EDGE_MARGIN * 2);
		const x = Math.round(trayBounds.x + Math.round(trayBounds.width / 2) - Math.round(width / 2));
		const y = Math.round(workArea.y + EDGE_MARGIN);

		panelWin.setBounds({ x, y, width, height });
		return;
	}

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

	if (isMac) {
		try {
			panelWin.setVibrancy('sidebar');
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		togglePanel();
	});
}

// ------- IPC: EXPORT / IMPORT -------

ipcMain.handle('tasks:export', async () => {
	const tasks = getTasks();
	const dir = app.getPath('downloads');
	const fname = `tasks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
	const full = path.join(dir, fname);
	await fs.promises.writeFile(full, JSON.stringify(tasks, null, 2), 'utf-8');
	return { path: full };
});

ipcMain.handle('tasks:import', async () => {
	const pick = await dialog.showOpenDialog({
		title: 'Обрати JSON з задачами',
		filters: [{ name: 'JSON', extensions: ['json'] }],
		properties: ['openFile'],
	});
	if (pick.canceled || !pick.filePaths?.length) return { imported: 0, skipped: 0, canceled: true };

	const raw = await fs.promises.readFile(pick.filePaths[0], 'utf-8');
	let incoming = [];
	try {
		incoming = JSON.parse(raw);
	} catch {
		return { imported: 0, skipped: 0, error: 'bad_json' };
	}
	if (!Array.isArray(incoming)) return { imported: 0, skipped: 0, error: 'not_array' };

	const current = getTasks();
	const seen = new Set(current.map((t) => t.id));
	let imported = 0,
		skipped = 0;

	for (const t of incoming) {
		if (!t || typeof t !== 'object') {
			skipped++;
			continue;
		}
		if (!t.id || seen.has(t.id)) {
			t.id = crypto.randomUUID(); // уникаємо перезапису
		}
		if (seen.has(t.id)) {
			skipped++;
			continue;
		}
		current.push(t);
		seen.add(t.id);
		imported++;
	}

	setTasks(current);
	checkDueAndNotify(); // на випадок дедлайнів
	return { imported, skipped };
});

app.whenReady().then(() => {
	if (isMac) {
		try {
			if (app.dock) app.dock.hide();
			if (app.setActivationPolicy) app.setActivationPolicy('accessory');
		} catch {}
	}

	createPanelWindow();

	try {
		tray = new Tray(nativeImage.createFromPath(RES('icon.png')));
		tray.setToolTip('Task Panel');
		tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open/Close', click: togglePanel }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
		tray.on('click', togglePanel);
	} catch (e) {
		console.log('Tray init error:', e);
	}

	globalShortcut.register('CommandOrControl+Alt+T', togglePanel);
	globalShortcut.register('Alt+`', togglePanel);

	screen.on('display-metrics-changed', () => {
		if (panelWin?.isVisible()) positionPanel();
	});

	app.setLoginItemSettings({ openAtLogin: true });

	ipcMain.handle('tasks:get', () => getTasks());
	ipcMain.handle('tasks:set', (_e, tasks) => {
		setTasks(tasks);
		checkDueAndNotify();
	});

	ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
	ipcMain.handle('autostart:set', (_e, enabled) => app.setLoginItemSettings({ openAtLogin: !!enabled }));

	ipcMain.handle('projects:get', () => projectsStore.get('items', []));
	ipcMain.handle('projects:set', (_e, items) => projectsStore.set('items', items || []));

	startScheduler();

	setTimeout(() => {
		togglePanel();
	}, 300);
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => globalShortcut.unregisterAll());
