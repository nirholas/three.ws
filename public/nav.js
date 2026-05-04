document.addEventListener('DOMContentLoaded', () => {
	const navContainer = document.getElementById('nav-container');
	if (navContainer) {
		fetch('/nav.html')
			.then(response => response.text())
			.then(data => {
				navContainer.innerHTML = data;
			});
	}
});