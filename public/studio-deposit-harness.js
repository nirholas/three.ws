import { mountLaunchPanel } from '/studio/launch-panel.js';
const fakeAvatar = { id: 'test-avatar', agent_id: 'agent-x', name: 'Test', description: 'test desc', thumbnail_url: null };
const fakeUser   = { id: 'user-x', email: 'test@example.com' };
mountLaunchPanel(document.getElementById('root'), {
	getAvatar: () => fakeAvatar,
	getUser:   () => fakeUser,
	getPreviewViewer: () => null,
}).avatarChanged();
window.__ready = true;
