# Prompt 24: Analytics and Tracking

## Objective
Integrate analytics events to track key user interactions throughout the monetization funnel, providing insights into user behavior and conversion rates.

## Explanation
To understand how users are interacting with the new payment features and to identify potential drop-off points, we need to track key events. This data is invaluable for making informed decisions on how to improve the feature. We can use a service like Segment, Amplitude, or a simple internal logging system.

## Instructions
1.  **Choose an Analytics Provider:**
    *   Select and set up an analytics service. For this example, we'll assume a simple global `analytics.track()` function is available (often provided by a Segment or similar script).

2.  **Define Key Events:**
    *   Identify the most important events to track in the monetization funnel:
        *   `Skill Purchase Initiated`: Fired when a user clicks the "Purchase" button.
        *   `Payment QR Code Displayed`: Fired when the QR code is successfully rendered.
        *   `Skill Purchase Succeeded`: Fired when the frontend confirms a successful purchase.
        *   `Skill Purchase Failed`: Fired when any error occurs during the process.
        *   `Skill Prices Saved`: Fired when a creator successfully saves new prices.

3.  **Implement Tracking Calls (Frontend):**
    *   In your frontend JavaScript (`src/marketplace.js`, `src/agent-edit.js`), call `analytics.track()` at the appropriate points in the code.
    *   Include relevant properties with each event, such as `agentId`, `skillName`, `price`, and `currency`.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// This is a placeholder for your analytics library's API
// e.g., window.analytics.track(...)
const trackEvent = (eventName, properties) => {
    console.log('[Analytics]', eventName, properties);
    // In a real app, this would send data to Segment, Amplitude, etc.
    if (window.analytics) {
        window.analytics.track(eventName, properties);
    }
};

// In handlePurchaseClick function
async function handlePurchaseClick(event) {
    // ...
    const skillName = button.dataset.skillName;
    const agentId = /* ... */;
    const price = /* ... get price ... */;

    // 1. Track when the purchase is initiated
    trackEvent('Skill Purchase Initiated', {
        agentId: agentId,
        skillName: skillName,
        price: price,
        currency: 'USDC',
    });

    try {
        // ... (API call to prepare purchase)

        // 2. Track when the QR code is shown
        trackEvent('Payment QR Code Displayed', {
            agentId: agentId,
            skillName: skillName,
        });

        // ... (Polling logic)
        if (status === 'confirmed') {
            // 3. Track successful purchase
            trackEvent('Skill Purchase Succeeded', {
                agentId: agentId,
                skillName: skillName,
                price: price,
            });
        }

    } catch (error) {
        // 4. Track failure
        trackEvent('Skill Purchase Failed', {
            agentId: agentId,
            skillName: skillName,
            error: error.message,
        });
        // ...
    }
}
```
