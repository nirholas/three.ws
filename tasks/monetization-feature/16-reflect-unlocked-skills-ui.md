# Prompt 16: Reflect Unlocked Skills on Page Load

## Objective
Update the frontend to call the new `/api/agents/:id/unlocked-skills` endpoint when the agent detail page loads, and use this data to correctly display the "Unlocked" state for skills.

## Explanation
The frontend now has an API to get the user's permanent skill entitlements. We need to call this API when the detail page loads and populate our `unlockedSkills` set from its response. This will ensure that the UI accurately reflects the user's purchase history from the moment the page becomes visible.

## Instructions
1.  **Locate the Frontend Logic:**
    *   Open `src/marketplace.js` and find the `loadDetail` function. This is the main function that orchestrates the loading of the agent detail page.

2.  **Fetch Unlocked Skills:**
    *   Inside `loadDetail`, after fetching the main agent details, make another `fetch` call to your new endpoint: `/api/agents/${id}/unlocked-skills`.
    *   Remember to include `credentials: 'include'` so the backend knows who the user is.
    *   This call can be made in parallel with the other agent detail calls (like versions and similar agents) using `Promise.all` for better performance.

3.  **Populate the State:**
    *   When the API call returns, it will have a JSON object like `{ skills: ["skill1", "skill2"] }`.
    *   Take this array of skill names and use it to initialize your global `unlockedSkills` set.

4.  **Ensure Correct Render Order:**
    *   Make sure that you populate the `unlockedSkills` set *before* you call the `renderSkillList` function. The `Promise.all` approach ensures this naturally. `loadDetail` should await all necessary data before it proceeds to render.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// At the top of the file, initialize the set
let unlockedSkills = new Set();


// Modify the loadDetail function
async function loadDetail(id) {
	els.discovery.hidden = true;
	els.detail.hidden = false;
	els.detail.scrollIntoView({ behavior: 'instant', block: 'start' });

	// Reset for the new page
	unlockedSkills = new Set();

	try {
        // Use Promise.all to fetch everything concurrently
		const [aR, vR, sR, unlockedR] = await Promise.all([
			fetch(`${API}/agents/${id}`),
			fetch(`${API}/agents/${id}/versions`),
			fetch(`${API}/agents/${id}/similar`),
            fetch(`${API}/agents/${id}/unlocked-skills`, { credentials: 'include' })
		]);

		const aJ = await aR.json();
		if (!aR.ok) {
			renderDetailError(aJ?.error_description || 'Agent not found');
			return;
		}

        // Populate the unlocked skills set
        const unlockedData = await unlockedR.json();
        if (unlockedData.skills) {
            unlockedSkills = new Set(unlockedData.skills);
        }

		const a = aJ.data.agent;
		detailState = { agent: a, bookmarked: !!aJ.data.bookmarked };

        // Now render everything with the correct data
		renderDetail(a, aJ.data.bookmarked);
		renderVersions((await vR.json())?.data?.versions || []);
		renderSimilar((await sR.json())?.data?.items || []);

		// Fire-and-forget view counter.
		fetch(`${API}/agents/${id}/view`, { method: 'POST' }).catch(() => {});
	} catch (err) {
		console.error('[marketplace] detail', err);
		renderDetailError('Failed to load agent.');
	}
}
```
With this change, `renderDetail` will call `renderSkillList`, which will now have access to the correctly populated `unlockedSkills` set, ensuring the UI is correct from the very first render.
