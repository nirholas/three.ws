# Prompt 9: "Payment Required" Modal in Chat

## Objective
Create a modal dialog in the chat UI that appears when a user needs to pay for a skill, clearly presenting the price and prompting for action.

## Explanation
When the backend signals that a skill requires payment, the frontend must stop the normal message flow and present the user with a clear choice. This modal is the centerpiece of the in-chat purchasing experience.

## Instructions
1.  **File to Edit:**
    *   Open the main JavaScript/Svelte/React component file for your chat interface (e.g., `chat/src/App.svelte` or similar).

2.  **Create the Modal HTML/Structure:**
    *   Add the HTML for a modal dialog. It should be hidden by default.
    *   The modal should contain:
        *   A title, e.g., "Premium Skill".
        *   A descriptive text, e.g., "The skill 'generate-image' requires a one-time payment to use."
        *   A display for the price (e.g., "Price: 1.00 USDC").
        *   A "Pay and Continue" button.
        *   A "Cancel" button or close icon.

3.  **Implement Frontend Logic:**
    *   Listen for the `payment_required` message from your backend (as designed in Prompt 8).
    *   When this message is received:
        *   Populate the modal with the `skill_name` and `price` information from the message data. Remember to format the amount from lamports to a user-friendly decimal format.
        *   Make the modal visible.

4.  **Handle Button Clicks:**
    *   **Cancel:** If the user clicks "Cancel" or closes the modal, hide the modal and perhaps send a "payment cancelled" message to the chat history.
    *   **Pay and Continue:** If the user clicks the pay button:
        *   Keep the modal open but show a loading/spinner state.
        *   Trigger the frontend payment flow function (which will be built in the next prompt). This function will orchestrate the API calls and wallet interaction.

## Code Example (Frontend - Svelte Component)

```svelte
<!-- In your main chat component, e.g., App.svelte -->

{#if paymentRequired}
<div class="modal-backdrop">
  <div class="modal">
    <h3>Premium Skill</h3>
    <p>
      The skill <strong>{paymentDetails.skill_name}</strong> requires a payment to continue.
    </p>
    <div class="price-display">
      Price: <span>{(paymentDetails.amount / 1e6).toFixed(2)} USDC</span>
    </div>
    
    {#if isLoadingPayment}
      <div class="spinner">Processing...</div>
    {:else}
      <div class="modal-actions">
        <button on:click={cancelPayment}>Cancel</button>
        <button class="primary" on:click={initiatePayment}>Pay and Continue</button>
      </div>
    {/if}
  </div>
</div>
{/if}

<script>
  let paymentRequired = false;
  let paymentDetails = {};
  let isLoadingPayment = false;

  // Function to be called when backend sends 'payment_required'
  function onPaymentRequired(details) {
    paymentDetails = details;
    paymentRequired = true;
    isLoadingPayment = false;
  }

  function cancelPayment() {
    paymentRequired = false;
    // Optionally add a "Cancelled" message to the chat history
  }

  async function initiatePayment() {
    isLoadingPayment = true;
    try {
      // This function will be implemented in the next prompt
      const result = await handlePaymentFlow(paymentDetails);
      if (result.success) {
        paymentRequired = false;
        // The backend will now re-run the skill and send the result.
      } else {
        // Handle payment failure, show an error
        isLoadingPayment = false;
      }
    } catch (err) {
      // Handle errors from the payment flow
      isLoadingPayment = false;
    }
  }
</script>

<style>
  /* Add styles for .modal-backdrop, .modal, .price-display, etc. */
</style>
```
