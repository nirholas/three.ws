// The native OS apps. Each one is a lazily loaded module in ./apps exporting
// `mount(host, ctx)` (see README.md). Titles, sizes and keywords live here so
// Start, search, the desktop and the taskbar know every app before its code loads.

const os = (a) => ({ native: true, os: true, dock: false, desktop: false, keywords: [], ...a });

export const OS_APPS = [
	os({ id: 'files', title: 'File Explorer', hue: 44, icon: 'files', size: { w: 920, h: 600 }, dock: true, desktop: true, desc: 'Browse, create and organize your files', keywords: ['folder', 'documents', 'downloads', 'explorer', 'file manager', 'this pc', 'trash', 'recycle'], load: () => import('./apps/files.js') }),
	os({ id: 'notepad', title: 'Notepad', hue: 205, icon: 'note', size: { w: 720, h: 520 }, desktop: true, desc: 'Write and edit text files', keywords: ['text', 'edit', 'txt', 'markdown', 'write', 'note'], load: () => import('./apps/notepad.js') }),
	os({ id: 'photos', title: 'Photos', hue: 190, icon: 'image', size: { w: 860, h: 600 }, desc: 'View pictures from your files', keywords: ['image', 'picture', 'png', 'jpg', 'viewer'], load: () => import('./apps/photos.js') }),
	os({ id: 'calculator', title: 'Calculator', hue: 215, icon: 'calc', size: { w: 360, h: 560 }, desktop: true, desc: 'Standard, scientific and unit conversion', keywords: ['math', 'calc', 'convert', 'units', 'scientific'], load: () => import('./apps/calculator.js') }),
	os({ id: 'clock', title: 'Clock', hue: 20, icon: 'clock', size: { w: 560, h: 560 }, desc: 'Alarms, timer, stopwatch and world clocks', keywords: ['alarm', 'timer', 'stopwatch', 'time zone', 'world clock'], load: () => import('./apps/clock.js') }),
	os({ id: 'weather', title: 'Weather', hue: 200, icon: 'cloud', size: { w: 760, h: 600 }, desktop: true, desc: 'Live forecast for any city', keywords: ['forecast', 'temperature', 'rain', 'wind'], load: () => import('./apps/weather.js') }),
	os({ id: 'camera', title: 'Camera', hue: 330, icon: 'camera', size: { w: 720, h: 560 }, desc: 'Take photos and record video', keywords: ['photo', 'webcam', 'video', 'record', 'selfie'], load: () => import('./apps/camera.js') }),
	os({ id: 'paint', title: 'Paint', hue: 12, icon: 'paint', size: { w: 900, h: 620 }, desktop: true, desc: 'Draw, sketch and annotate images', keywords: ['draw', 'sketch', 'whiteboard', 'canvas', 'brush'], load: () => import('./apps/paint.js') }),
	os({ id: 'terminal', title: 'Terminal', hue: 150, icon: 'terminal', size: { w: 760, h: 480 }, dock: true, desc: 'A real command line for your desktop and three.ws', keywords: ['shell', 'cli', 'command', 'bash', 'console', 'cmd'], load: () => import('./apps/terminal.js') }),
	os({ id: 'taskmgr', title: 'Task Manager', hue: 160, icon: 'taskmgr', size: { w: 820, h: 560 }, desc: 'Running apps and live system performance', keywords: ['processes', 'performance', 'cpu', 'memory', 'end task', 'monitor'], load: () => import('./apps/taskmgr.js') }),
	os({ id: 'media', title: 'Media Player', hue: 280, icon: 'music', size: { w: 760, h: 520 }, desc: 'Play audio and video files', keywords: ['music', 'audio', 'video', 'mp3', 'mp4', 'player'], load: () => import('./apps/media.js') }),
];
