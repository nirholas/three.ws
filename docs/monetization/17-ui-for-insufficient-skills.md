# Prompt 17: UI for Insufficient Skills

## Objective
Create a user interface in the chat window that gracefully handles cases where the user tries to use a premium skill they don't own, and prompts them to purchase it.

## Explanation
When the backend blocks an action due to a missing skill (from the previous prompt), the frontend needs to interpret this specific response and present a clear call-to-action to the user. Instead of a generic error, we should guide them directly to the marketplace to acquire the needed skill.

## Instructions
1.  **Handle the Specific API Response (Frontend):**
    *   In your frontend chat logic, when you make a request to the chat API, check the response status code.
    *   If you receive a `402 Payment Required` status, you know it's a skill-related issue.
    *   Read the JSON body of the response, which will contain the `skillName` and the message.

2.  **Render a Special Chat Bubble:**
    *   Instead of rendering a normal error message, create a new type of chat bubble.
    *   This bubble should display the message from the API (e.g., "This action requires the 'MarketAnalysis' skill.").
    *   Crucially, it must include a button or link that says "Purchase Skill" or "Unlock in Marketplace".
    *   This button should link directly to the agent's detail page in the marketplace, possibly with a query parameter to highlight the required skill (e.g., `/marketplace/agent/<agent_id>?highlight_skill=MarketAnalysis`).

## Code Example (Frontend - `src/chat.js`)

```javascript
async function sendMessage(messageText) {
    const chatHistory = document.getElementById('chat-history');
    
    try {
        const response = await fetch('/api/chat', { /* ... POST data ... */ });

        if (!response.ok) {
            if (response.status === 402) {
                // This is our special case for a required skill
                const data = await response.json();
                renderPurchasePrompt(data);
            } else {
                // Handle other server errors
                throw new Error(`Server error: ${response.status}`);
            }
            return; 
        }

        const data = await response.json();
        renderAgentMessage(data.response);

    } catch (error) {
        renderErrorMessage(error.message);
    }
}

function renderPurchasePrompt(data) {
    const chatHistory = document.getElementById('chat-history');
    const agentId = getCurrentAgentId(); // Helper to get the current agent's ID

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble agent-bubble purchase-prompt';
    bubble.innerHTML = `
        <p>${escapeHtml(data.message)}</p>
        <a 
            href="/marketplace/agent/${agentId}?highlight_skill=${encodeURIComponent(data.skillName)}" 
            class="purchase-prompt-btn"
        >
            Unlock Skill
        </a>
    `;
    chatHistory.appendChild(bubble);
}
```

## CSS for the Prompt Bubble

```css
.purchase-prompt {
  background-color: rgba(253, 224, 71, 0.1);
  border: 1px solid rgba(253, 224, 71, 0.3);
}

.purchase-prompt-btn {
  display: inline-block;
  margin-top: 10px;
  padding: 8px 16px;
  background-color: var(--accent);
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 600;
}
```
