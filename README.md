# Agents Inventory

Interactive prototype for Utopia Studio's AI agent directory inside Studio OS.

## What it is

An internal tool for the Studio team to catalog, evaluate, and manage AI agents. Two tabs: **Agents** (catalog) and **Requests** (intake pipeline). It supports the full lifecycle: discover agents → understand how to use them → evaluate performance → request new ones → triage and build.

## Flows

- **Browse agents** — card grid with client-side filtering by category and status
- **View agent detail** — full metadata, "When to use", step-by-step SOP, inputs/outputs, eval & observability, technical details (integrations, access/repo URLs)
- **Add agent** — full form: Identity, SOP & Usage, Platform & Classification
- **Edit agent** — same form pre-filled, plus an Eval & Observability section
- **Update eval** — quick form: eval status, reviewed date, notes, known issues
- **Request an agent** — title, description, requester, priority
- **Triage requests** — requests grouped by status (In Progress → Approved → Requested, plus resolved: Shipped / Declined); click a request to change status, priority, assignee, and notes

All forms validate required fields, show a toast on success, and update the UI immediately.

The agent record is organised around the four pillars an agent is only ever as
good as — **goals, skills, tools, context** — plus an append-only eval history
and a human-in-the-loop `proposedImprovement`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and the strategy note [docs/strategy.html](docs/strategy.html).

## Stack

Front-end: vanilla HTML/CSS/JS. No dependencies, no build step, static deploy.
An **optional** zero-dependency Node service (`server/`) adds the observability +
self-improvement loop; the front-end degrades gracefully to local-only when it
isn't running.

```
├── index.html    ← HTML shell
├── styles.css    ← ceramic design tokens + component styles
├── app.js        ← state, rendering, modals, form handlers, the loop UI
├── api.js        ← optional bridge to the loop service (auto-detected)
├── fonts/        ← TWK Lausanne (internal use)
├── vercel.json   ← static config
├── docs/         ← ARCHITECTURE.md, strategy.html
└── server/       ← loop service (traces · eval · GEPA/optimizer) — see server/README.md
```

Data persists to `localStorage` (nothing resets on reload). Run the loop service
with `cd server && npm start`.

## Design system

Uses Utopia's **ceramic** design tokens (theme: `utopia-default`), applied as CSS custom properties in [styles.css](styles.css). The token block at the top of the file is the single source of truth — replace it when Aiden ships updated tokens.

## Local development

Just open `index.html` in a browser. Or:

```sh
npx serve .
```

## Deployment

Connected to Vercel. Pushes to `main` auto-deploy.

## Project context

- Part of Studio OS (utopia-studio.co) — lives under **Resources → Agents**
- Follows the same card grid pattern as the Programme Modules tab
- Linear project: [Agent Inventory](https://linear.app/the-utopia-studio/project/agent-inventory-e962d3f8b3de/overview)
- Product spec: see `agents-inventory-mvp-spec-v03.pdf`

## Roadmap

- **v1** — Internal catalog + request pipeline *(current)*
- **v2** — Two-sided directory (fellows-facing + studio-facing), provisioning, token system
- **v3** — Agent factory (build & deploy agents from within OS)
