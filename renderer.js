function panic(msg) {
	const b = document.createElement('div');
	b.style.cssText = 'background:#ff5252;color:#111;padding:10px;border-radius:8px;margin-bottom:10px;font-weight:600';
	b.textContent = msg;
	document.querySelector('.panel')?.prepend(b);
	console.error(msg);
}

async function boot() {
	if (!window.taskAPI || !window.sys || !window.projectsAPI) {
		panic('Preload міст не підвантажився. Перевір preload.cjs та webPreferences.');
		return;
	}

	const listEl = document.getElementById('list');
	const modal = document.getElementById('addModal');
	const afTitle = document.getElementById('afTitle');
	const afProjectSelect = document.getElementById('afProjectSelect');
	const afTags = document.getElementById('afTags');
	const afDue = document.getElementById('afDue');
	const afRemind = document.getElementById('afRemind');

	const pmWrap = document.getElementById('pmWrap');
	const pmList = document.getElementById('pmList');
	const pmNew = document.getElementById('pmNew');

	let tasks = [];
	let projects = [];
	let activeQuick = 'all';

	const uniqNorm = (s) => s.trim().toLowerCase();
	const parseDate = (d) => (d ? new Date(d.includes('T') ? d : `${d}T09:00:00`) : null);
	const isToday = (d) =>
		d &&
		(() => {
			const n = new Date();
			return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
		})();
	const isOverdue = (d) => d && d.getTime() < Date.now();
	const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	const snoozeBadge = (t) => (!t.snoozedUntil || Date.now() >= t.snoozedUntil ? '' : `<span class="tag snoozed">snoozed to ${fmtTime(t.snoozedUntil)}</span>`);
	const dueBadge = (t) => {
		if (!t.due) return '';
		const d = parseDate(t.due);
		const over = isOverdue(d) && !t.done;
		return `<span class="tag ${over ? 'bad' : 'ok'}">due:${d.toLocaleString()}</span>`;
	};
	const remindBadge = (t) => {
		if (!t.due) return '';

		const lead = Number(t.remindBeforeMin) || 0;
		if (t.snoozedUntil && Date.now() < t.snoozedUntil) {
			const hhmm = new Date(t.snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			return `<span class="tag">rem: ${hhmm} (snooze)</span>`;
		}
		if (lead <= 0) return '';
		const d = parseDate(t.due);
		if (d) {
			const fireAt = new Date(d.getTime() - lead * 60 * 1000);
			const hhmm = fireAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			return `<span class="tag">rem: за ${lead} хв (${hhmm})</span>`;
		}
		return `<span class="tag">rem: за ${lead} хв</span>`;
	};

	function matchFilter(t, f) {
		if (f && f.trim()) {
			const tokens = f.trim().split(/\s+/);
			const ok = tokens.every((tok) => {
				if (tok.startsWith('proj:')) return t.project === tok.slice(5);
				if (tok.startsWith('+')) return t.tags.includes(tok.slice(1));
				if (tok.startsWith('due:')) {
					const v = tok.slice(4);
					if (v === 'today') return isToday(parseDate(t.due));
					return (t.due || '') === v;
				}
				return (t.title || '').toLowerCase().includes(tok.toLowerCase());
			});
			if (!ok) return false;
		}
		const d = parseDate(t.due);
		if (activeQuick === 'today') return isToday(d);
		if (activeQuick === 'overdue') return isOverdue(d) && !t.done;
		if (activeQuick === 'next') return !t.done && !isOverdue(d);
		return true;
	}

	async function loadProjects() {
		projects = (await window.projectsAPI.get()) || [];
		const seen = new Set();
		projects = projects.filter((p) => {
			const key = uniqNorm(p);
			if (!key) return false;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		await window.projectsAPI.set(projects);
		renderProjectSelect();
		renderProjectManager();
	}
	function renderProjectSelect() {
		const current = afProjectSelect.value;
		afProjectSelect.innerHTML = `<option value="">(без проєкту)</option>` + projects.map((p) => `<option value="${p}">${p}</option>`).join('');
		if (projects.includes(current)) afProjectSelect.value = current;
	}
	function renderProjectManager() {
		pmList.innerHTML = '';
		projects.forEach((p) => {
			const row = document.createElement('div');
			row.className = 'pm-item';
			row.innerHTML = `<span>${p}</span><button data-act="del" class="btn">Видалити</button>`;
			row.querySelector('button').onclick = async () => {
				projects = projects.filter((x) => x !== p);
				if (afProjectSelect.value === p) afProjectSelect.value = '';
				await window.projectsAPI.set(projects);
				renderProjectSelect();
				renderProjectManager();
			};
			pmList.appendChild(row);
		});
	}

	function applyTheme(theme) {
		const t = theme === 'light' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', t);
		localStorage.setItem('tp_theme', t);
		const btn = document.getElementById('themeBtn');
		if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
	}
	function toggleTheme() {
		const cur = localStorage.getItem('tp_theme') || 'dark';
		applyTheme(cur === 'dark' ? 'light' : 'dark');
	}
	const preferred = localStorage.getItem('tp_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
	applyTheme(preferred);
	document.getElementById('themeBtn').addEventListener('click', toggleTheme);

	document.getElementById('manageProjects').onclick = () => {
		pmWrap.style.display = pmWrap.style.display === 'none' || !pmWrap.style.display ? 'flex' : 'none';
	};
	document.getElementById('pmAdd').onclick = async () => {
		const name = pmNew.value.trim();
		if (!name) return;
		if (!projects.includes(name)) projects.push(name);
		pmNew.value = '';
		await window.projectsAPI.set(projects);
		renderProjectSelect();
		renderProjectManager();
	};
	document.getElementById('pmClose').onclick = () => {
		pmWrap.style.display = 'none';
	};

	let openMenuEl = null;
	function closeSnoozeMenu() {
		if (openMenuEl) {
			openMenuEl.remove();
			openMenuEl = null;
		}
	}
	function openSnoozeMenu(x, y, onPick) {
		closeSnoozeMenu();
		const root = document.createElement('div');
		root.className = 'snooze-menu';
		root.style.right = `2px`;
		root.style.top = `${y}px`;
		root.innerHTML = `
      <button data-min="5">Відкласти на 5 хв</button>
      <button data-min="10">Відкласти на 10 хв</button>
      <button data-min="30">Відкласти на 30 хв</button>
      <button data-min="60">Відкласти на 1 год</button>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:6px 0;">
      <button data-min="0">Скасувати відкладення</button>`;
		root.addEventListener('click', (e) => {
			e.stopPropagation();
			const btn = e.target.closest('button');
			if (!btn) return;
			const min = parseInt(btn.dataset.min, 10);
			onPick(min);
			closeSnoozeMenu();
		});
		document.body.appendChild(root);
		openMenuEl = root;
	}
	document.addEventListener('mousedown', (e) => {
		if (!openMenuEl) return;
		if (e.target.closest('.snooze-btn')) return;
		if (!openMenuEl.contains(e.target)) closeSnoozeMenu();
	});
	window.addEventListener('blur', closeSnoozeMenu);

	async function load() {
		try {
			tasks = (await window.taskAPI.getTasks()) || [];
		} catch (e) {
			panic('IPC tasks:get не працює.');
			console.error(e);
		}
		render();
	}
	async function save() {
		try {
			await window.taskAPI.setTasks(tasks);
		} catch (e) {
			panic('IPC tasks:set не працює.');
			console.error(e);
		}
	}

	function render() {
		const filter = document.getElementById('filter').value;
		listEl.innerHTML = '';
		tasks
			.filter((t) => matchFilter(t, filter))
			.sort((a, b) => a.done - b.done || (parseDate(a.due)?.getTime() || Infinity) - (parseDate(b.due)?.getTime() || Infinity) || a.created - b.created)
			.forEach((t) => {
				const li = document.createElement('li');
				if (t.done) li.classList.add('done');
				li.innerHTML = `
          <input type="checkbox" ${t.done ? 'checked' : ''}/>
          <div style="flex:1">
            <div>
              ${t.title}
              ${t.project ? `<span class="tag">proj:${t.project}</span>` : ''}
              ${t.tags?.map((x) => `<span class="tag">+${x}</span>`).join(' ') || ''}
              ${dueBadge(t)} ${remindBadge(t)} ${snoozeBadge(t)}
            </div>
          </div>
          <button class="snooze-btn" data-act="snooze" title="Відкласти">🕒</button>
          <button data-act="del" title="Видалити">✕</button>`;
				li.querySelector('input').addEventListener('change', async (e) => {
					t.done = e.target.checked;
					await save();
					render();
				});
				li.querySelector('[data-act=del]').addEventListener('click', async () => {
					tasks = tasks.filter((x) => x.id !== t.id);
					await save();
					render();
				});
				li.querySelector('[data-act=snooze]').addEventListener('click', (ev) => {
					ev.stopPropagation();
					const rect = ev.currentTarget.getBoundingClientRect();
					const y = Math.round(rect.bottom);
					openSnoozeMenu(0, y, async (minutes) => {
						if (minutes > 0) t.snoozedUntil = Date.now() + minutes * 60 * 1000;
						else t.snoozedUntil = null;
						await save();
						render();
					});
				});
				listEl.appendChild(li);
			});
	}

	function openModal() {
		modal.style.display = 'flex';
		pmWrap.style.display = 'none';
		afTitle.value = '';
		afTags.value = '';
		afDue.value = '';
		afRemind.value = '10';
		setTimeout(() => afTitle.focus(), 50);
	}
	function closeModal() {
		modal.style.display = 'none';
	}

	document.getElementById('addFab').onclick = openModal;
	document.getElementById('afCancel').onclick = closeModal;
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});

	async function saveFromModal() {
		const title = afTitle.value.trim();
		if (!title) return;

		const tags = (afTags.value || '')
			.split(/[\s,]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => (s.startsWith('+') ? s.slice(1) : s));

		const project = afProjectSelect.value || null;
		const dueVal = afDue.value || null;
		const remind = parseInt(afRemind.value, 10);

		const t = {
			id: crypto.randomUUID(),
			title,
			project,
			tags,
			done: false,
			created: Date.now(),
			due: dueVal,
			remindBeforeMin: isNaN(remind) ? 10 : remind,
			snoozedUntil: null,
		};
		tasks.push(t);
		await save();
		render();
		closeModal();
	}
	document.getElementById('afSave').onclick = saveFromModal;
	afTitle.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveFromModal();
	});

	document.getElementById('apply').onclick = render;
	document.querySelectorAll('.filters button').forEach((btn) =>
		btn.addEventListener('click', () => {
			activeQuick = btn.dataset.filter;
			render();
		})
	);

	function notify(msg, kind = 'ok') {
		const b = document.createElement('div');
		b.textContent = msg;
		b.style.cssText = `
      position:absolute; left:14px; right:14px; bottom:72px;
      padding:10px 12px; border-radius:10px;
      background:${kind === 'ok' ? 'rgba(76,175,80,.9)' : 'rgba(244,67,54,.9)'};
      color:#111; font-weight:600; z-index:9999; box-shadow:0 8px 20px rgba(0,0,0,.25)`;
		document.querySelector('.panel')?.appendChild(b);
		setTimeout(() => b.remove(), 2200);
	}

	document.getElementById('btnExport').onclick = async () => {
		try {
			const res = await window.io.exportTasks();
			if (res?.path) notify(`Експортовано: ${res.path}`);
			else notify('Експорт скасовано', 'err');
		} catch (e) {
			console.error(e);
			notify('Помилка експорту', 'err');
		}
	};

	document.getElementById('btnImport').onclick = async () => {
		try {
			const res = await window.io.importTasks();
			if (res?.error) {
				notify(`Помилка імпорту (${res.error})`, 'err');
				return;
			}
			if (res?.canceled) return;
			notify(`Імпортовано: ${res.imported}, пропущено: ${res.skipped}`);
			if (res?.imported > 0) await load();
		} catch (e) {
			console.error(e);
			notify('Помилка імпорту', 'err');
		}
	};

	try {
		const tgl = document.getElementById('autostartToggle');
		tgl.checked = await window.sys.getAutostart();
		tgl.onchange = async () => {
			await window.sys.setAutostart(tgl.checked);
		};
	} catch (e) {
		console.warn('Autostart IPC недоступний:', e);
	}

	await loadProjects();
	await load();
}

window.addEventListener('DOMContentLoaded', boot);
