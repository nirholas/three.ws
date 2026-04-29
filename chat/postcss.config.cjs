const tailwindcss = require('tailwindcss');
const tailwindcssNesting = require('tailwindcss/nesting');
const autoprefixer = require('autoprefixer');

const config = {
	plugins: [tailwindcss(), tailwindcssNesting(), autoprefixer],
};

module.exports = config;
