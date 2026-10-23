import { useEffect, useRef } from 'react';
import { createArStudio } from '3d-ar-studio';

/**
 * The AR studio as a React component.
 *
 * The studio owns a WebGL context and a camera stream, so it is mounted once per
 * container and torn down on unmount. `options` is read when the studio mounts;
 * to change something later, reach for the instance through `onReady`.
 */
export default function ArStudio({ options = {}, onReady, style, className }) {
	const host = useRef(null);
	const ready = useRef(onReady);
	ready.current = onReady;

	useEffect(() => {
		if (!host.current) return undefined;
		const studio = createArStudio(host.current, { fullscreen: false, ...options });
		ready.current?.(studio);
		return () => studio.destroy();
		// Options are intentionally not a dependency: re-creating a WebGL context
		// on every render would be ruinous. Drive changes through the instance.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return <div ref={host} className={className} style={{ position: 'relative', minHeight: '70vh', ...style }} />;
}
