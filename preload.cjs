const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
	getTasks: () => ipcRenderer.invoke('tasks:get'),
	setTasks: (tasks) => ipcRenderer.invoke('tasks:set', tasks),
});

contextBridge.exposeInMainWorld('sys', {
	getAutostart: () => ipcRenderer.invoke('autostart:get'),
	setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
});

contextBridge.exposeInMainWorld('projectsAPI', {
	get: () => ipcRenderer.invoke('projects:get'),
	set: (items) => ipcRenderer.invoke('projects:set', items),
});

contextBridge.exposeInMainWorld('io', {
	exportTasks: () => ipcRenderer.invoke('tasks:export'),
	importTasks: () => ipcRenderer.invoke('tasks:import'),
});
