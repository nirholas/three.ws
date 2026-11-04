// GET/POST /api/human-tasks: the collection routes of the human-task API.
// The catch-all [...route].js handles every deeper path; a dynamic catch-all does
// not match the bare directory, so this re-export serves it.
export { default } from './[...route].js';
