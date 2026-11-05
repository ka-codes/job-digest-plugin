# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

International development professionals searching for senior roles — including the growing AI-for-good / governance crossover — who install and run this themselves.

## Product Purpose

Automates the tedious parts of a senior-level international-development job search — scanning employer boards and aggregators, scoring fit against the user's real CV and experience, tracking applications, and drafting cover letters — so the user spends their time deciding and applying, not searching. Success is a digest the user actually trusts and checks, not one more unread tab.

## Positioning

Unlike a hosted job-search SaaS, this is local-first: each user installs and runs it on their own machine. No central service ever holds anyone's CV, salary target, or application history. It reuses the user's existing Claude Code login for all AI work rather than requiring a second subscription or API key, and it ships real Greenhouse/Lever API connectors plus a pre-seeded international-development employer list, instead of generic keyword search against a blank slate.

## Operating Context

A one-time setup wizard (upload CV + optional cover letter, set preferences, set refresh frequency) is followed by a local Node/Express server that stays running — ideally started at login — and refreshes the digest on its own schedule by shelling out to the Claude Code CLI headlessly. The user reviews new roles, saves ones they like, tracks applications through status changes, and drafts cover letters live, all from a browser pointed at `localhost`. No step ever applies, logs in, or contacts anyone on the user's behalf.

## Capabilities and Constraints

- Local-only data: profile, CV, cover letters, tracked roles, and applications live in a private folder on the user's own machine, never hosted or transmitted elsewhere.
- Requires Node.js and an authenticated Claude Code installation on the same machine. All AI work (fit scoring, letter drafting, employer resolution) runs through headless `claude -p` calls — no separate AI integration or credential.
- Real connectors exist today for Greenhouse and Lever boards; every other employer falls back to web search.
- Ships as two coupled pieces: a Claude Code plugin (skill, commands, connector scripts) and a companion local web app (this UI) that shells out to it — two processes sharing the same data files, not a single framework app.
- Existing codebase (evidence, not greenfield): vanilla HTML/CSS/JS frontend, no build step or framework, served by a small Express/Node backend.

## Brand Commitments

Working name "job-digest" for both the plugin and the app — not treated as final or locked. No existing logo, mark, or settled visual identity; open for this redesign to establish one.

## Evidence on Hand

- Real data schemas for roles and applications (`docs/DATA-SCHEMA.md`).
- A real, user-curated international-development employer list (`templates/profile.example.md`): multilateral bodies, bilateral agencies, major INGOs, foundations, and an "AI for good" cross-section.
- A working v1 build of the setup wizard and four-screen dashboard (Home, Job Digest, Saved Jobs, Applications, CV & Letters) in the current dark "true-black-flat" visual system — the system now being replaced by this redesign.

## Product Principles

1. Local-first and self-hosted — the product never becomes something the author operates as a service on others' behalf.
2. Reuse one AI integration (Claude Code) everywhere, rather than adding a second credential or cost path.
3. Prefer real, deterministic data sources (board APIs) over generic AI search wherever one exists.
4. Ship usable sector defaults, always editable — never force a blank-page start.
5. Never take an action (apply, contact, log in) on the user's behalf.

## Accessibility & Inclusion

No product-specific requirement established yet beyond the standard web accessibility baseline (keyboard operability, visible focus, sufficient contrast).
