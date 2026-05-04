---
status: not-started
---

# Prompt 10: Frontend - Display Referral System Info

## Objective
Integrate the user's referral code and performance statistics into their profile page.

## Explanation
To make the referral program successful, users must be able to easily find their unique referral code and track how many people they've referred. By displaying this information clearly on their profile page, we empower them to become advocates for the platform.

## Instructions
1.  **Update the Profile Page HTML:**
    *   Open the `profile.html` file.
    *   Add a new section titled "Referral Program".
    *   Inside this section, add elements with unique IDs to display:
        *   The user's referral code.
        *   A "copy to clipboard" button next to the code.
        *   The number of users they have successfully referred.
        *   Their total referral earnings to date.

2.  **Modify the Profile Page JavaScript:**
    *   Open `src/profile.js`.
    *   In the function that fetches profile data, also make a GET request to the `/api/users/referrals` endpoint you created previously.
    *   When the data is returned, populate the new elements in `profile.html` with the `referral_code`, `referred_users_count`, and `referral_earnings_total`.

3.  **Implement the "Copy to Clipboard" Functionality:**
    *   Add a click event listener to the copy button.
    *   When clicked, use the `navigator.clipboard.writeText()` API to copy the referral code to the user's clipboard.
    *   Provide visual feedback to the user, e.g., by changing the button text to "Copied!" for a few seconds.

## HTML Example (`profile.html`)

```html
<section id="referral-section">
  <h2>Referral Program</h2>
  <p>Share your code to earn rewards!</p>
  <div class="referral-code-wrapper">
    <strong>Your Code:</strong>
    <span id="referral-code"></span>
    <button id="copy-referral-btn">Copy</button>
  </div>
  <div class="referral-stats">
    <div>
      <p>Users Referred</p>
      <strong id="referred-users-count">0</strong>
    </div>
    <div>
      <p>Total Earnings</p>
      <strong id="referral-earnings-total">$0.00</strong>
    </div>
  </div>
</section>
```

## JavaScript Snippet (`src/profile.js`)

```javascript
// After fetching data from /api/users/referrals
const referralData = await response.json();

document.getElementById('referral-code').textContent = referralData.referral_code;
document.getElementById('referred-users-count').textContent = referralData.referred_users_count;
document.getElementById('referral-earnings-total').textContent = `$${referralData.referral_earnings_total.toFixed(2)}`;

document.getElementById('copy-referral-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(referralData.referral_code);
  // ... provide visual feedback
});
```
