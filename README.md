# Schettini Design AI — Backend Cloudflare Free

Backend Vercel compatibile con la v0.5.8 di Schettini Design AI.

## Provider
Cloudflare Workers AI — `@cf/runwayml/stable-diffusion-v1-5-inpainting`

## Variabili Vercel Production
- `APP_ACCESS_PASSWORD` (già esistente)
- `APP_JWT_SECRET` (già esistente)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_TOKEN`
- opzionale `CLOUDFLARE_IMAGE_MODEL=@cf/runwayml/stable-diffusion-v1-5-inpainting`

`OPENAI_API_KEY` non è richiesta per `/api/photo/clean`.

## Endpoint
- GET `/api/health`
- POST `/api/session`
- POST `/api/photo/clean`

La modalità gratuita richiede una maschera manuale nell'app prima di premere Pulisci con AI.


## Fix risposta immagini
Questa revisione normalizza output Cloudflare binario/JSON/base64 prima di restituirlo al frontend e impedisce errori `atob()`.
