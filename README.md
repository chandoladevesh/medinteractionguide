# MedInteractionGuide

MedInteractionGuide is a free U.S.-focused drug-drug and drug-food interaction checker.

## Current architecture

The public page is a static index.html served by Cloudflare Pages. Interaction checks now use a same-origin Pages Function at /api/check.

The Pages Function normalizes medicine names with the U.S. National Library of Medicine RxNorm API, retrieves U.S. FDA drug-label records through openFDA, and returns evidence from the retrieved interaction sections. Keeping these API calls server-side avoids relying on browser-to-third-party API behavior and gives the project a clean place for future caching, rate limiting, logging, and API-key management.

## Important interpretation rule

A result labeled **Interaction information found in FDA labeling** means the retrieved FDA interaction section directly mentioned the other medicine or food term.

A result labeled **No direct mention found in retrieved FDA interaction sections** does **not** mean the combination is safe and does not establish that no interaction exists. FDA labeling varies by product and may not contain every possible interaction.

## Data sources

- U.S. FDA drug-label information through openFDA: https://open.fda.gov/
- U.S. National Library of Medicine RxNorm API: https://lhncbc.nlm.nih.gov/RxNav/APIs/

This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services. NLM is not responsible for this product and does not endorse or recommend it.

## Deployment

The repository is connected to Cloudflare Pages. A push to the configured branch should create a new deployment when Pages Git integration is enabled.

## Disclaimer

MedInteractionGuide is an informational tool. It does not provide medical advice, diagnosis, or treatment. Users should consult a qualified healthcare professional about individual medication decisions.
