# Prompt 24: Add Analytics and Tracking for Monetization

## Objective
Integrate analytics events to track key user actions in the monetization funnel, such as viewing a paid skill, starting a purchase, and completing a purchase.

## Explanation
To understand user behavior and optimize the monetization feature, we need data. By firing analytics events at each step of the purchase flow, we can build funnels in analytics tools (like Google Analytics, Vercel Analytics, or PostHog) to see where users drop off and identify areas for improvement.

## Instructions
1.  **Choose an Analytics Provider:**
    *   If the project doesn't already have one, select an analytics provider. Let's assume Vercel Analytics is being used.

2.  **Create a Tracking Utility:**
    *   In a frontend utility file (e.g., `src/analytics.js`), create a simple wrapper function for sending events. This makes it easy to swap providers later.

    ```javascript
    // src/analytics.js
    import { track } from '@vercel/analytics';

    export function trackEvent(name, properties) {
      try {
        track(name, properties);
      } catch (e) {
        console.warn('Analytics tracking failed', e);
      }
    }
    ```

3.  **Instrument the Frontend Code:**
    *   Import and call `trackEvent` at key moments:
    *   **View Agent with Priced Skill:** In `src/marketplace.js`, when `renderDetail` is called for an agent with paid skills.
        *   `trackEvent('ViewPricedSkill', { agentId, skillId, price });`
    *   **Click "Buy" Button:** In the `onBuySkill` event handler.
        *   `trackEvent('StartPurchase', { agentId, skillId });`
    *   **Purchase Succeeded:** In the `onPurchaseSuccess` callback after polling confirms the purchase.
        *   `trackEvent('CompletePurchase', { agentId, skillId, price });`
    *   **Purchase Failed/Cancelled:** If the user closes the modal or the polling times out.
        *   `trackEvent('CancelPurchase', { agentId, skillId });`

## Example Integration

```javascript
// In src/marketplace.js
import { trackEvent } from './analytics.js';

// When "Buy" is clicked
function onBuySkill(agentId, skillId) {
    trackEvent('StartPurchase', { agentId, skillId });
    // ... rest of the function
}

// When purchase is confirmed
function onPurchaseSuccess(skillId) {
    trackEvent('CompletePurchase', { skillId });
    // ... rest of the function
}
```
