---
status: not-started
---
# Prompt 16: Implement Dark Mode

**Status:** Not Started

## Objective
Implement a site-wide dark mode theme to improve user comfort in low-light environments and provide a modern look and feel.

## Explanation
Dark mode is a popular user preference. We will implement it using CSS variables for easy toggling and use `localStorage` to remember the user's choice.

## Instructions
1.  **Define CSS Color Variables:**
    *   In your main stylesheet (`style.css`), define two sets of color variables within the `:root` and a `[data-theme='dark']` selector.
    *   Use these variables throughout all your CSS files.
2.  **Create a Theme Toggler:**
    *   Add a button or toggle switch to your site's header or footer.
    *   When clicked, this button will toggle the `data-theme` attribute on the `<html>` or `<body>` element.
3.  **Use JavaScript to Manage State:**
    *   Write a script that:
        *   On page load, checks `localStorage` for a saved theme preference.
        *   Also checks the user's OS preference via `prefers-color-scheme` media query as a default.
        *   Applies the correct `data-theme` attribute.
        *   Updates `localStorage` whenever the user clicks the theme toggler.

## Code Example (CSS)
```css
/* style.css */
:root {
  --background-color: #ffffff;
  --text-color: #333333;
  --primary-color: #3d8bfd;
  --card-bg-color: #f9f9f9;
}

[data-theme='dark'] {
  --background-color: #121212;
  --text-color: #f5f5f5;
  --primary-color: #5a9fff;
  --card-bg-color: #1e1e1e;
}

body {
  background-color: var(--background-color);
  color: var(--text-color);
}

.agent-card {
    background-color: var(--card-bg-color);
}
```

## Code Example (JavaScript)
```javascript
// theme-switcher.js
const themeToggle = document.getElementById('theme-toggle');
const currentTheme = localStorage.getItem('theme');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

if (currentTheme) {
  setTheme(currentTheme);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  setTheme('dark');
}

themeToggle.addEventListener('click', () => {
  const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
});
```
