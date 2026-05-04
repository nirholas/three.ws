# Prompt 20: User Reviews and Ratings for Skills

**Status:** - [ ] Not Started

## Objective
Implement a system for users to leave reviews and ratings for purchased skills, and display these on the agent detail page.

## Explanation
Social proof is a powerful driver for purchasing decisions. Allowing users to rate and review skills helps other users make informed decisions and provides valuable feedback to creators.

## Instructions
1.  **Database Schema for Reviews:**
    *   Create a `skill_reviews` table:
        *   Columns: `id`, `user_id`, `agent_id`, `skill_name`, `rating` (1-5), `review_text`, `created_at`.

2.  **UI for Submitting a Review:**
    *   On the "My Purchased Skills" page (from Prompt 11), add a "Leave a Review" button next to each skill the user has not yet reviewed.
    *   Clicking this button should open a modal or form with a star rating system (1-5) and a textarea for the review text.

3.  **Backend for Submitting Reviews:**
    *   Create an endpoint `/api/skills/submit-review`.
    *   This endpoint must verify that the user owns the skill they are reviewing before accepting the review.
    *   It will insert the new review into the `skill_reviews` table.

4.  **Display Reviews and Average Rating:**
    *   Modify the agent detail endpoint (`/api/marketplace/agents/:id`) to also fetch and aggregate review data for the agent's skills.
    *   For each skill, calculate the average rating and the total number of reviews.
    *   On the `marketplace.html` detail page, display the average star rating next to each skill.
    *   Consider adding a new tab or section on the detail page to display all written reviews for the agent's skills.

## Code Example (UI for displaying rating)

```javascript
// In the marketplace.js skill rendering loop
const averageRating = skill.average_rating || 0;
const reviewCount = skill.review_count || 0;

let ratingDisplay = '';
if (reviewCount > 0) {
  ratingDisplay = `<span class="skill-rating">
                     ${'★'.repeat(Math.round(averageRating))}${'☆'.repeat(5 - Math.round(averageRating))}
                     (${reviewCount})
                   </span>`;
}

// Add ratingDisplay to the skill entry HTML
return `<div class="skill-entry">
          <span class="skill-name">${escapeHtml(name)}</span>
          ${ratingDisplay}
          ${badgeOrButton}
        </div>`;
```
