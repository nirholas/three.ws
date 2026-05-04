---
status: not-started
---
# Prompt 11: Agent Creation Wizard

**Status:** Not Started

## Objective
Create a user-friendly, step-by-step wizard for creating a new agent. This will improve the user experience compared to a single, long form.

## Explanation
Creating a new agent involves multiple pieces of information: name, description, 3D model, skills, etc. A multi-step wizard breaks this down into manageable chunks, guiding the user through the process and improving completion rates.

## Instructions
1.  **Create a new page:** `create-agent.html`.
2.  **Design a multi-step UI:**
    *   Use JavaScript to create a tab-like interface or a component that shows one step at a time.
    *   Steps could be:
        1.  **Basic Info:** Name, Description, Tags.
        2.  **3D Model:** Upload a GLB/glTF file or choose from a default library.
        3.  **Skills:** Add/remove skills for the agent.
        4.  **Voice & Personality:** (Future feature, but plan for it) Set TTS voice and base prompt.
        5.  **Review & Create:** Show a summary and a final "Create Agent" button.
3.  **State Management:**
    *   Store the agent data in a JavaScript object as the user moves through the steps.
    *   Implement "Next" and "Back" buttons.
4.  **API Integration:**
    *   On the final step, the "Create Agent" button should POST the complete agent object to a new API endpoint: `/api/agents/create`.
    *   The backend will handle creating the new agent in the database.

## UI Sketch
```
+-------------------------------------------------------------+
| Create Your Agent                                           |
+-------------------------------------------------------------+
| [Step 1: Info] -> [Step 2: Model] -> [Step 3: Skills] ...   |
+-------------------------------------------------------------+
|                                                             |
|   +--------------------------+                              |
|   | Agent Name               |                              |
|   | [______________________] |                              |
|   |                          |                              |
|   | Agent Description        |                              |
|   | [______________________] |                              |
|   | [______________________] |                              |
|   +--------------------------+                              |
|                                                             |
|                                         +--------------+    |
|                                         |     Next >   |    |
|                                         +--------------+    |
+-------------------------------------------------------------+
```
