# React component

Copy `src/ArStudio.jsx` into your app and install the two packages:

```bash
npm i 3d-ar-studio three
```

```jsx
import ArStudio from './ArStudio';

export default function Page() {
	return (
		<ArStudio
			options={{ branding: { title: 'Acme AR' }, assets: 'https://your.cdn/models.json' }}
			onReady={(studio) => studio.on('add', ({ placement }) => console.log(placement.title))}
			style={{ height: '80vh' }}
		/>
	);
}
```

The component mounts the studio once and destroys it on unmount, which releases
the camera stream and the WebGL context. Everything else is driven through the
instance handed to `onReady`: `addModel`, `clear`, `getScene`, `setScene`,
`shareUrl`, `generate`, `openRoom`.
