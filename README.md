# Schettini Design AI — Cloudflare Free backend v3

Fix specifico per rimozione cucina:
- prompt di inpainting descrive solo l'ambiente vuoto (non i requisiti della nuova cucina);
- ritaglio automatico della zona mascherata con contesto;
- espansione leggera della maschera per eliminare bordi residui;
- strength 1, guidance 11, 20 step;
- ricomposizione del risultato sulla foto originale, quindi il resto dell'immagine resta invariato.

Mantiene le stesse variabili Vercel della v2.
