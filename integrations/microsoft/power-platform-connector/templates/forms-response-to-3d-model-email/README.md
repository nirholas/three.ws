# Forms response to a 3D character, emailed back

Run a "design your mascot" form at an event, in a class, or for customers. Each respondent describes a character and gets an email with their character as a 3D model they can rotate in the browser, place in AR on a phone, or download.

## What it does

1. **Trigger:** Microsoft Forms "When a new response is submitted" on your form.
2. Forms "Get response details" reads the response. The description question becomes the prompt, prefixed with "a stylized 3D character:".
3. **three.ws "Generate a 3D model from text"** at `standard` quality.
4. While the job is `pending`, a **Do until** loop waits 20 seconds and calls **three.ws "Get generation job"**, for at most 45 minutes.
5. Outlook "Send an email (V2)" sends the respondent the viewer, AR and GLB links, or a short note with the reason if the model could not be generated.

## Before you import

- A Microsoft Form with a long answer question for the description. The form must record respondent names (set "Record name" in the form settings), because the email goes to the `responder` address.
- An Office 365 Outlook mailbox to send from.
- A three.ws connection.

## Parameters

| Parameter | What to enter |
|---|---|
| Form id | Pick the form in the trigger to fill this in |
| Description question id | The question key from the Get response details output, which starts with `r` (run the flow once and open the output to copy it) |

## Import

Import `workflow.json` as described in [the templates README](../README.md), map the Forms, three.ws and Outlook connection references, and fill in the parameters. Submit a response to your form to test it.
