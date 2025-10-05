const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
	getTasks: () => ipcRenderer.invoke('tasks:get'),
	setTasks: (tasks) => ipcRenderer.invoke('tasks:set', tasks),
});

contextBridge.exposeInMainWorld('sys', {
	getAutostart: () => ipcRenderer.invoke('autostart:get'),
	setAutostart: (v) => ipcRenderer.invoke('autostart:set', v),
});

contextBridge.exposeInMainWorld('projectsAPI', {
	get: () => ipcRenderer.invoke('projects:get'),
	set: (items) => ipcRenderer.invoke('projects:set', items),
});
