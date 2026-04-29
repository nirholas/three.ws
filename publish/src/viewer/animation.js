import { AnimationMixer } from 'three';

export function setClips(viewer, clips) {
	if (viewer.mixer) {
		viewer.mixer.stopAllAction();
		viewer.mixer.uncacheRoot(viewer.mixer.getRoot());
		viewer.mixer = null;
	}

	viewer.clips = clips;
	if (!clips.length) return;

	viewer.mixer = new AnimationMixer(viewer.content);
}

export function playAllClips(viewer) {
	viewer.clips.forEach((clip) => {
		viewer.mixer.clipAction(clip).reset().play();
		viewer.state.actionStates[clip.name] = true;
	});
	viewer.invalidate();
}
