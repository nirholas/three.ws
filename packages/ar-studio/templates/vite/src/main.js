import { createArStudio } from '3d-ar-studio';

const studio = createArStudio('#stage', {
	branding: { title: '__TITLE__', accent: '__ACCENT__' },
	// assets: 'https://your.cdn/models.json',
	fullscreen: false,
});

// Everything the studio does is observable.
studio.on('add', ({ placement }) => console.log('placed', placement.title));
studio.on('generate', ({ model }) => console.log('generated', model.src));
