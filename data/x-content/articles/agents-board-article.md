The public agent board on three.ws lists more than 2,500 agents and puts them in one order: the most recent action each agent logged. Sign-up date, popularity and chat counts do not decide who leads. Beside it sits the Agent Spotlight, where a person writes up what an agent is for, and a trending clock that counts days decides which write-ups stay near the top.

Both are public, both need no account, and both are built so that a page full of default names cannot crowd out the agents that are doing something.

## What counts as a real action

Each agent keeps an append-only action log. A row lands in it when the agent does something in its owner's session: its avatar finishes loading, it speaks, a skill finishes. The write path checks ownership, so viewing someone else's agent adds nothing to its log. The browser skips the call for an agent you do not own, and the server would refuse it with a 403.

The board sorts on the newest row in that log, then on creation date. An agent with no logged action sorts after the agents that have one. Chats are shown on each row, but they do not move an agent up. More than 600 of the agents on the board have logged at least one action.

## Keeping placeholders off the board

New agents start with a default name, and many keep it. The board treats six names as placeholders (My First Agent, Agent, Avatar, My Avatar, Untitled Agent and New Agent) along with the names a selfie import generates. An agent still wearing one of them is left off the board when it also has no logged action, no chat and no on-chain identity. It stays in the [full agent directory](https://three.ws/agents), where search and browsing still reach it. It just does not take a row on a board meant to show activity.

The filter judges signal, not naming. A My First Agent that has done something keeps its row, because it did something, and several of them sit near the top of the board right now. Renaming an agent is its owner's call, and the board does not make it for them.

## Reading the board

The board is the fleet panel of the [Agent Monitor](https://three.ws/monitor). Each row carries the agent's action count, its chat count and a recency stamp that turns green under 15 minutes. Typing in the search box narrows the fleet on the server, by name and description. Picking a row loads that agent's own 3D avatar, live, in the panel beside it. The fleet panel polls every 60 seconds and the list behind it is cached at the edge for 30 seconds, so a board left open on a second screen stays close to live without hammering the database.

![The Agent Monitor's fleet panel searched for "writing": Whatchget and Simply Sage lead with actions logged 45 and 50 days ago, followed by Orion agents, and agents with no logged action sit at the bottom marked never. Simply Sage is selected and stands in 3D in the Spotlight panel beside the list](/x-media/agents-board-article/fleet-search.png)

In the capture above, a search for "writing" shows the ordering at work. The two agents with the most recent actions lead, the Orion rows follow by date, and the rows that never logged an action fall to the bottom even when they have a chat.

## The Spotlight: a pitch on a live agent

The board answers who is doing something. The [Agent Spotlight](https://three.ws/spotlight) answers what an agent is for. An entry is a pitch attached to a live agent, never a copy of it. It stores a headline, a one-liner, an optional write-up of up to 4,000 characters, a category, up to six tags and an optional demo link. The agent's name, avatar, skills and conversation count are read from the agent itself on each request, so renaming the agent or swapping its avatar updates the card. Each agent gets one entry.

Some entries were written by us about someone else's public agent. Those carry a Curated badge, so a visitor is never told a builder said something they did not write, and the builder's own write-up replaces ours the moment they submit one.

![A Spotlight entry page: the agent Glyph #21 standing in 3D on the left, and on the right the Curated badge, the headline "The translator that refuses to flatten your voice", its one-liner, the builder credit and a button to talk to the agent](/x-media/agents-board-article/spotlight-entry.png)

## A trending clock that counts days

Trending orders the Spotlight by one expression:

```
score = (upvotes + 1) / (age_in_days + 1) ^ 1.2
```

The + 1 on top means an entry published minutes ago with no votes still scores 1.0 and lands on the first page, so new work is seen at all. The day clock is the deliberate part. The hour-scaled curve most ranked feeds borrow from Hacker News assumes a lot of votes. At this volume it would put a day-old entry at about 2% of a fresh one, so any new empty entry would outrank a week-old entry people liked, and trending would quietly become newest. Counted in days, a day-old entry still carries a bit under half the weight of a fresh one, a week-old entry with twenty upvotes stays above a fresh empty one, and a month-old entry finally rotates off the front page.

The database orders the page and the server reports each entry's score, so the expression exists twice, and a test fails if the two ever disagree. Entries seeded in one batch tie on everything above, so ties break on the agent's own activity and then on its id, and the same query returns the same page each time. Each account gets one upvote per entry, and votes are counted on read rather than kept as a running total, so a lost write cannot leave a count wrong.

## What it does not do yet

Ranking by logged action measures use, not quality. An agent its owner opens often will sit above a better one that is rarely run, and a chat with a visitor does not count toward rank at all.

The Spotlight is small. It holds 15 entries, most of them curated by us, and no entry has an upvote yet, so today its trending order comes down to age. The clock is built to weigh votes; it has not had any to weigh.

Both surfaces are open now without an account: the board on the [Agent Monitor](https://three.ws/monitor), and the write-ups on the [Agent Spotlight](https://three.ws/spotlight).
