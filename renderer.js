// renderer.js
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
	const projectSelect = document.getElementById('projectSelect');
	const pmWrap = document.getElementById('pmWrap');
	const pmList = document.getElementById('pmList');
	const pmNew = document.getElementById('pmNew');

	let tasks = [];
	let projects = [];
	let activeQuick = 'all';

	// ---------- helpers ----------
	const uniqNorm = (s) => s.trim().toLowerCase();
	const parseInline = (s) => {
		const task = { id: crypto.randomUUID(), title: '', project: null, tags: [], due: null, remindBeforeMin: 10, done: false, created: Date.now(), snoozedUntil: null };
		s.trim()
			.split(/\s+/)
			.forEach((tok) => {
				if (tok.startsWith('proj:')) task.project = tok.slice(5);
				else if (tok.startsWith('+')) task.tags.push(tok.slice(1));
				else if (tok.startsWith('due:')) task.due = tok.slice(4);
				else task.title += (task.title ? ' ' : '') + tok;
			});
		return task;
	};

	const parseDate = (d) => (d ? new Date(d.includes('T') ? d : `${d}T09:00:00`) : null);
	const isToday = (d) =>
		d &&
		(() => {
			const n = new Date();
			return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
		})();
	const isOverdue = (d) => d && d.getTime() < Date.now();

	const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const snoozeBadge = (t) => (!t.snoozedUntil || Date.now() >= t.snoozedUntil ? '' : `<span class="tag snoozed">snoozed до ${fmtTime(t.snoozedUntil)}</span>`);
	const dueBadge = (t) => {
		if (!t.due) return '';
		const d = parseDate(t.due);
		const over = isOverdue(d) && !t.done;
		return `<span class="tag ${over ? 'bad' : 'ok'}">due:${d.toLocaleString()}</span>`;
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

	// ---------- Projects UI ----------
	async function loadProjects() {
		projects = (await window.projectsAPI.get()) || [];
		// ensure unique, trimmed
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
		const sel = projectSelect;
		const current = sel.value;
		sel.innerHTML = `<option value="">(без проєкту)</option>` + projects.map((p) => `<option value="${p}">${p}</option>`).join('');
		if (projects.includes(current)) sel.value = current;
	}

	function renderProjectManager() {
		pmList.innerHTML = '';
		projects.forEach((p) => {
			const row = document.createElement('div');
			row.className = 'pm-item';
			row.innerHTML = `<span>${p}</span><button data-act="del">Видалити</button>`;
			row.querySelector('button').onclick = async () => {
				projects = projects.filter((x) => x !== p);
				// якщо видалили активний у селекті — скинемо
				if (projectSelect.value === p) projectSelect.value = '';
				await window.projectsAPI.set(projects);
				renderProjectSelect();
				renderProjectManager();
			};
			pmList.appendChild(row);
		});
	}

	const remindBadge = (t) => {
		const lead = Number(t.remindBeforeMin) || 0;
		if (lead <= 0) return ''; // без нагадування — нічого не показуємо
		const d = parseDate(t.due);
		if (d) {
			const fireAt = new Date(d.getTime() - lead * 60 * 1000);
			const hhmm = fireAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			return `<span class="tag">rem: за ${lead} хв (${hhmm})</span>`;
		}
		return `<span class="tag">rem: за ${lead} хв</span>`;
	};

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

	// ----- Snooze menu -----
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
      <button data-min="0">Скасувати відкладення</button>
    `;
		root.addEventListener('click', async (e) => {
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

	// ---------- CRUD tasks ----------
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
          <input type="checkbox" ${t.done ? 'checked' : ''} />
          <div style="flex:1">
            <div>
              ${t.title}
              ${t.project ? `<span class="tag">proj:${t.project}</span>` : ''}
              ${t.tags.map((x) => `<span class="tag">+${x}</span>`).join(' ')}
              ${dueBadge(t)} ${remindBadge(t)} ${snoozeBadge(t)}
            </div>
          </div>
          <button class="snooze-btn" data-act="snooze" title="Відкласти">🕒</button>
          <button data-act="del" title="Видалити">✕</button>
        `;

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
					const x = Math.round(rect.left);
					const y = Math.round(rect.bottom);
					openSnoozeMenu(x, y, async (minutes) => {
						if (minutes > 0) t.snoozedUntil = Date.now() + minutes * 60 * 1000;
						else t.snoozedUntil = null;
						await save();
						render();
					});
				});

				listEl.appendChild(li);
			});
	}

	document.getElementById('add').onclick = async () => {
		const titleEl = document.getElementById('title');
		const dueEl = document.getElementById('due');
		const remindEl = document.getElementById('remind');
		const title = titleEl.value.trim();
		if (!title) return;

		const typed = parseInline(title);
		const dueVal = dueEl.value;
		const remind = parseInt(remindEl.value, 10);

		const chosenProject = projectSelect.value || null;
		// inline proj:... має пріоритет над дропдауном
		const project = typed.project ?? chosenProject;

		const t = {
			id: crypto.randomUUID(),
			title: typed.title || title,
			project,
			tags: typed.tags,
			done: false,
			created: Date.now(),
			due: dueVal || typed.due || null,
			remindBeforeMin: isNaN(remind) ? 10 : remind,
		};
		tasks.push(t);
		titleEl.value = '';
		dueEl.value = '';
		await save();
		render();
	};

	document.getElementById('apply').onclick = render;
	document.querySelectorAll('.filters button').forEach((btn) => {
		btn.addEventListener('click', () => {
			activeQuick = btn.dataset.filter;
			render();
		});
	});

	// автозапуск тумблер
	try {
		const tgl = document.getElementById('autostartToggle');
		tgl.checked = await window.sys.getAutostart();
		tgl.onchange = async () => {
			await window.sys.setAutostart(tgl.checked);
		};
	} catch (e) {
		console.warn('Autostart IPC недоступний (можна пропустити у dev):', e);
	}

	await loadProjects();
	await load();
}

window.addEventListener('DOMContentLoaded', boot);
