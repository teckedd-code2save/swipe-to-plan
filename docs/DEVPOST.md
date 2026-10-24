# Unstressed

Draft saved on Devpost, October 24, 2026. The [live demo](https://unstressed.serendepify.com) and [public MIT-licensed repository](https://github.com/teckedd-code2save/swipe-to-plan) are saved in both the public project links and required additional information. Devpost is at 4/5 steps; final rules acceptance and submission remain pending.

Project started: **22 October 2026**, confirmed by GitHub repository creation (2026-10-22T20:43:49Z) and the earliest commit. This is a **new build for the Qloo Agentic Hackathon**, not an upgrade to an existing project.

## Inspiration

Planning an outing for a group is a small coordination problem disguised as a restaurant search. One person cares about food, another wants somewhere creative, and someone else needs to keep spending light. A list of popular places leaves the group to do the hard work.

Unstressed gives that work to an agent, while keeping the people and their preferences visible.

## What it does

Tell Unstressed who is coming and what you have in mind. Bring a saved circle, add someone new, or change a participant’s tastes in conversation. Food, activities, music, mood and spending preferences feed the same plan. Taste cards appear inside the chat, and edits rework the itinerary rather than creating a disconnected recommendation list.

The result is a one-to-three-stop outing with suggested times, real venues, a group budget allocation and a checklist. Keep a stop you love, replace another, or ask for just one place. The plan stays within reach beside the conversation, with direct access on mobile.

A visual Connections view traces people to their stated preferences and then to each stop. It distinguishes Qloo-reported artist contributions, matching place tags and preferences used in the search without individual contribution evidence.

Circles let familiar groups plan again without starting from scratch. Google sign-in keeps account tastes and circles, while personal links let participants contribute to a shared day. Download a group or personal daybook and a calendar itinerary, or share a link to the evolving plan.

## How we built it

The interface uses React and Vite; the API uses Node.js and Express. Gemini interprets conversation into validated planning and participant tools. Application code manages the roster, scheduling, budget arithmetic, kept stops and revisions.

Qloo is the cultural intelligence layer. We resolve explicitly supplied artists to Qloo entities and food or activity preferences to Qloo tags. Each participant’s signals retrieve real place candidates. The planner checks category and location evidence, balances group rankings, and chooses distinct stops. Evidence from each participant’s own results supplies the Connections view.

Without Qloo, the product loses the cross-domain retrieval and provider evidence that make those recommendations and taste connections possible. The language model is not allowed to invent the venue list.

## Challenges we ran into

A preference used in a search is not proof that it caused a recommendation. We had to preserve that distinction in both the data and the visual explanation. We also had to prevent one participant from inheriting another person’s evidence.

Group edits introduce concurrency: a swipe or new participant can arrive while the previous plan is still being assembled. Versioned updates prevent older results from replacing newer choices. If discovery fails, the last complete plan remains visible and is clearly marked as previous.

## Accomplishments and what we learned

The central loop works with real Qloo results: change a person, their tastes or the brief, then see the shared plan respond. We have exercised live Gemini conversation, Google sign-in, single-stop outings and plans in Ghana, London, Paris, New York and Tokyo.

Cultural grounding is most useful when people can inspect it. Showing the path from a person to a preference to a place makes the agent’s reasoning easier to question and refine.

## What’s next

Test the full experience with more real circles and measure how well the shared plan serves different tastes. We also want better route and opening-hours data. Today, times and budgets are planning allowances: venue prices, availability, travel time and individual suitability still need confirmation. Unstressed does not make bookings.
