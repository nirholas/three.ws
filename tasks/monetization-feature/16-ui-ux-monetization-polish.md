---
status: not-started
---

# Prompt 16: UI/UX - Monetization Polish

## Objective
Review and refine the user interface and experience for all new monetization features to ensure they are intuitive, trustworthy, and visually appealing.

## Explanation
A polished UI is not just about aesthetics; it builds user trust, which is paramount when dealing with payments and earnings. This task involves a comprehensive review of all monetization-related user flows, from purchasing a skill to checking earnings, to identify and fix any points of friction or confusion.

## Instructions
1.  **Review the Skill Purchase Flow:**
    *   Go through the process of buying a skill, from the marketplace page to the payment modal.
    *   Is the price clear? Is the "Purchase" button prominent?
    *   Is the payment modal easy to understand? Does it provide clear feedback on success or failure?
    *   Add loading indicators to buttons after they are clicked to prevent double-submission.

2.  **Enhance the Creator Earnings Dashboard:**
    *   Review the `earnings.html` page.
    *   Are the summary cards easy to read? Use clear, large fonts for the key numbers.
    *   Is the sales history table well-formatted? Ensure dates and currency are localized.
    *   Consider adding simple charts to visualize earnings over time.

3.  **Improve the Referrals Section:**
    *   Look at the referral info on the `profile.html` page.
    *   Is the "Copy" button obvious? Does it provide clear feedback?
    *   Add a brief, encouraging explanation of how the referral program works and what the rewards are.

4.  **Refine the API Keys Management Page:**
    *   Review the `api-keys.html` page.
    *   When a new key is generated, is the warning to save it immediately prominent and clear?
    *   Is the process of revoking a key straightforward? Add a confirmation step (e.g., "Are you sure you want to revoke this key?") to prevent accidents.

5.  **Ensure Consistency:**
    *   Check that all new buttons, badges, modals, and tables use a consistent design language that matches the rest of the application.
    *   Use consistent terminology (e.g., "Purchase" vs. "Buy", "Earnings" vs. "Revenue").

## Example UI Polish Checklist

- [ ] Buttons have clear loading states.
- [ ] Error messages are user-friendly and displayed in a consistent location.
- [ ] All monetary values are formatted correctly (e.g., `$1,234.56`).
- [ ] Forms have proper validation feedback.
- [ ] The purpose of each page and section is immediately clear to a new user.
- [ ] The mobile view for all new pages is clean and usable.
