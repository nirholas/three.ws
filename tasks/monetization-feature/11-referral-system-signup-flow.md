---
status: not-started
---

# Prompt 11: Frontend - Add Referral Code to Signup

## Objective
Update the user registration form to include an optional field for a referral code.

## Explanation
To create the link between a referrer and a new user, the referral code must be captured at the moment of signup. This involves adding a new input field to the registration UI and ensuring this data is sent to the backend API.

## Instructions
1.  **Modify the Registration HTML:**
    *   Locate the HTML file that contains your user registration form (e.g., this might be in `app.html`, `index.html`, or handled by a JavaScript template).
    *   Add a new text input field to the form.
    *   Label it clearly, for example, "Referral Code (Optional)".
    *   Give it a `name` and `id`, such as `referral_code`.

2.  **Update the Registration JavaScript:**
    *   Find the JavaScript code that handles the registration form submission.
    *   When you gather the form data to send to the `/api/auth/register` endpoint, include the value from the new referral code input.
    *   Since the field is optional, your code should handle cases where it's empty.

3.  **Ensure Backend Compatibility:**
    *   This step relies on the backend changes from the earlier referral system task, where the `/api/auth/register` endpoint was updated to accept a `referralCode` field in its request body. No backend changes are needed for this prompt if that was done correctly.

## HTML Form Example

```html
<!-- Inside your registration form -->
<form id="register-form">
  <div>
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
  </div>
  <div>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
  </div>
  <div>
    <label for="referral_code">Referral Code (Optional)</label>
    <input type="text" id="referral_code" name="referral_code">
  </div>
  <button type="submit">Sign Up</button>
</form>
```

## JavaScript Form Handling Example

```javascript
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  // The backend expects 'referralCode' (camelCase) from the validation schema
  const payload = {
    email: data.email,
    password: data.password,
    referralCode: data.referral_code, // Ensure key matches backend expectation
  };

  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Only include referralCode if it has a value
    body: JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([_, v]) => v))),
  });

  // ... handle response
});
```
