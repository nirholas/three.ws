---
status: not-started
---

# Prompt 21: User Ratings and Reviews for Skills

**Status:** Not Started

## Objective
Allow users who have purchased a skill to leave a rating and a written review.

## Explanation
Social proof is a powerful driver of sales. Ratings and reviews help users make informed decisions and reward high-quality work from creators.

## Instructions
- [ ] **Create a `skill_reviews` table:**
    - `id`, `user_id`, `agent_id`, `skill_name`, `rating` (1-5), `comment` (text), `created_at`.
- [ ] **On the agent detail page, after a user has purchased a skill, allow them to submit a review.**
- [ ] **Create API endpoints for submitting and fetching reviews.**
    - `POST /api/skills/review`: to submit a new review. The backend should verify that the user actually owns the skill.
    - `GET /api/agents/:id/reviews`: to fetch all reviews for an agent's skills.
- [ ] **Display the average rating and the number of reviews** next to each skill in the marketplace.
- [ ] **Create a "Reviews" tab** on the agent detail page where users can read all the reviews for that agent's skills.
