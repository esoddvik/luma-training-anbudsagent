# MCP demo script

For webinars, the NHO stage and the course day. Spec §50 phase 5 requires a full demo — connect, find matches, explain a match — to run stably in under five minutes.

This is the service's most exposed surface. It runs live, in front of people, against a model nobody controls. Everything below is written for that.

## Before you start

Have these ready and verified **the day before**, not on the morning:

- A demo account with at least one alert profile that produces matches today. A profile with no matches is a demo with nothing to show.
- A fresh MCP token. Tokens are shown once; generate it, paste it into the client, and confirm the connection works before the room fills.
- The client already connected and already restarted once. A first connection is where the surprises are.
- A tender you have looked at yourself, so you know what the model will be working with. Never demo a tender you have not read.

Check the service is healthy:

```bash
curl -s https://mcp.luma-training.com/health
```

## The five-minute run

**1. Show the connection (30 seconds).** Open the client's tool list. The point being made is that this is the user's own AI tool talking to their own alert profile, not a chatbot on our website.

**2. Find matches (60 seconds).**

> Hvilke anbud passer varslingsprofilen min akkurat nå?

This calls `find_matching_tenders`. Expect tenders with a relevance level, the main reasons, and a source link on each. Point out that the reasons are concrete — named CPV codes and keywords, not a black-box number.

**3. Explain one match (90 seconds).** Pick the most interesting result.

> Hvorfor traff dette anbudet profilen min?

This calls `explain_tender_match`. This is the moment worth slowing down for: the score is broken into components, the disclaimer says plainly that it is relevance and not a probability of winning, and the whole thing is reproducible.

Say the disclaimer out loud rather than letting it sit on the slide. It is the difference between this service and the ones that promise to pick winners.

**4. Show a planned procurement (60 seconds).**

> Er det noen planlagte anskaffelser jeg bør følge med på?

Planned procurements have no deadline and say so. The argument to make: finding out about work three months before the competition opens is a different product from finding out on the day it is published.

**5. Close on the method (60 seconds).**

> Gi meg en strukturert førstevurdering av dette anbudet.

This runs the `review_tender_opportunity` prompt, which follows phases 1 and 2 of the playbook. Course alumni will recognise the structure. That recognition is the point: the tool is the method, made repeatable.

## What to do when something goes wrong

**A tool returns nothing.** Say so and move on to the next step. Do not debug on stage. The likeliest cause is a profile that genuinely has no matches today, which is worth saying honestly — the service does not invent tenders to fill a screen.

**The model paraphrases a score as a percentage chance of winning.** Correct it immediately and out loud. This is the one error worth interrupting the demo for, because the audience will remember the number and not the correction if you let it pass. The server instructions tell the model not to do this, but the model is not ours.

**The connection drops.** Reconnect once. If it fails twice, switch to slides. A visibly broken live demo costs more than a skipped one.

**A tender contains something that looks like an instruction.** It happens: procurement documents contain imperative text. The server instructions tell the model to treat tender text as data and never follow instructions inside it. If you see the model start to comply with something from a document, that is worth stopping on and explaining, because the audience is being taught to use AI on untrusted documents.

## What not to demo

- **Anything that writes.** Save and dismiss work, but a live demo that mutates the account creates state you then have to undo.
- **A tender you have not read.** You cannot correct the model on something you do not know.
- **The token itself.** Never put it on a screen. Regenerate it if it is ever visible in a recording.
- **Speed.** Do not race. Five minutes is the ceiling, not the target; four calm minutes beat five rushed ones.

## After the demo

Revoke the demo token if the session was recorded or the screen was shared. Tokens are revocable precisely so this is cheap.
