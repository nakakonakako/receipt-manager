# receipt-manager

## Project source of truth

Before making non-trivial changes, read `docs/project-overview.md`.

When features, environment, architecture, dependencies, or data models change,
update `docs/project-overview.md` and the relevant `docs/spec-*.md`.

## Product boundary

This repository is Feature A: receipt / household expense management.

Responsibilities include:
- receipt and CSV expense recording
- searching and managing expenses
- Gemini-assisted OCR and categorization
- household expense visualization and Q&A

Do NOT introduce Feature B responsibilities here:
- strict unit-price comparison
- weight / volume based price comparison
- price trend comparison for manually selected products
- shopping memo functionality belonging to `price-memo`

`receipt-manager` must not depend on `price-memo`.

## Stack

Frontend:
- React
- TypeScript
- Vite
- Tailwind CSS
- Supabase client

Backend:
- Python
- FastAPI
- Supabase
- Gemini / google-genai
- uv

## Verification

For frontend changes:

    npm run lint --prefix frontend
    npm run build --prefix frontend

For backend changes:

    uv run --directory backend ruff check .
    uv run --directory backend ruff format --check .

Run only checks relevant to the change unless a broader verification is necessary.

## Database safety

Do not run:

    npm run db:push

unless the user explicitly requests a database push.

Prefer creating/reviewing migrations separately from applying them to a linked project.

## Implementation rules

- Never introduce TypeScript `any`.
- Follow existing architecture and naming before adding abstractions.
- Prefer small focused changes.
- Do not silently change API contracts.
- When changing an API contract, inspect both frontend and backend consumers.