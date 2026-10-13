import { createRoot } from 'react-dom/client';
import { Agent3DView } from '../src/Agent3DView';

const params = new URLSearchParams(window.location.search);
const root = createRoot(document.getElementById('root') as HTMLElement);

root.render(
	<Agent3DView
		model={params.get('model') || 'https://three.ws/avatars/default.glb'}
		background={(params.get('background') as 'transparent' | 'dark' | 'light') || 'dark'}
		framing={(params.get('framing') as 'full' | 'portrait') || 'full'}
		autoplay
		width="480px"
		height="480px"
	/>,
);
