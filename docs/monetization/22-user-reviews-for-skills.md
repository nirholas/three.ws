---
status: not-started
---

# Prompt 22: User Reviews and Ratings for Skills

## Objective
Allow users to leave reviews and ratings for the skills they have purchased.

## Explanation
Social proof is a powerful factor in purchasing decisions. Reviews and ratings will help users identify high-quality skills and build trust in the marketplace.

## Instructions
1.  **Update Database Schema:**
    *   Create a `skill_reviews` table with columns for `skill_name`, `user_id`, `rating` (1-5), and a `comment`.

2.  **UI for Reviews:**
    *   On the agent detail page, display the average rating for each skill.
    *   Add a section where users can read all reviews for a skill.
    *   Allow users who have purchased a skill to submit a review.
