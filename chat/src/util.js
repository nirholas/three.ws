/**
 * Reads an image file, resizes it if necessary, and returns it as a Data URL.
 *
 * @param {File} file - The image file to read and resize.
 * @returns {Promise<string>} - A promise that resolves to the Data URL of the (resized) image.
 */
export function readFileAsDataURL(file) {
	const MAX_DIMENSION = 1568; // Maximum allowed size for the longest edge

	return new Promise((resolve, reject) => {
		// Ensure the file is an image
		if (!file.type.startsWith('image/')) {
			reject(new Error('The provided file is not an image.'));
			return;
		}

		const reader = new FileReader();

		// Load the file as a Data URL
		reader.onload = () => {
			const img = new Image();

			img.onload = () => {
				let { width, height } = img;

				// Determine the scaling factor if resizing is needed
				const scalingFactor = calculateScalingFactor(width, height, MAX_DIMENSION);

				if (scalingFactor < 1) {
					width = Math.round(width * scalingFactor);
					height = Math.round(height * scalingFactor);
				}

				// Create a canvas to draw the (resized) image
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;

				const ctx = canvas.getContext('2d');

				// Draw the image onto the canvas with the new dimensions
				ctx.drawImage(img, 0, 0, width, height);

				// Convert the canvas to a Data URL (you can specify image format and quality if needed)
				canvas.toDataURL(file.type, 0.92); // 0.92 is the default quality for JPEG

				// Resolve the promise with the Data URL
				resolve(canvas.toDataURL(file.type));
			};

			img.onerror = () => {
				reject(new Error('Failed to load the image.'));
			};

			img.src = reader.result;
		};

		reader.onerror = () => {
			reject(new Error('Failed to read the file.'));
		};

		reader.readAsDataURL(file);
	});
}

/**
 * Calculates the scaling factor to resize the image so that its longest edge is within the max dimension.
 *
 * @param {number} width - The original width of the image.
 * @param {number} height - The original height of the image.
 * @param {number} maxDimension - The maximum allowed size for the longest edge.
 * @returns {number} - The scaling factor (<=1). Returns 1 if no resizing is needed.
 */
function calculateScalingFactor(width, height, maxDimension) {
	const longestEdge = Math.max(width, height);
	if (longestEdge <= maxDimension) {
		return 1; // No resizing needed
	}
	return maxDimension / longestEdge;
}

export function debounce(func, wait) {
	const timers = new Map();

	return function (...args) {
		const id = args[0].id; // Assuming the first argument has an `id` property

		if (timers.has(id)) {
			clearTimeout(timers.get(id));
		}

		const timer = setTimeout(() => {
			func.apply(this, args);
			timers.delete(id);
		}, wait);

		timers.set(id, timer);
	};
}
