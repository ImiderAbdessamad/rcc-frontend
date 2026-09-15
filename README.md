# RCC frontend (WFB scoring)

Interface RCC copiée depuis `wafabail-rcc` (branche `abderrrahmane`) et branchée
sur le backend scoring WFB. **Aucun fichier `.env` n'est nécessaire.**

## Lancer

1. Backend WFB (port 8002) :

```bash
cd WFB/backend
python -m uvicorn app.main:app --reload --port 8002
```

2. Frontend RCC :

```bash
cd rcc-frontend
npm install
npm run dev
```

L'UI s'ouvre sur http://127.0.0.1:5175 et proxy `/api` vers `http://127.0.0.1:8002`.
Aucun `.env` : l'URL du backend est dans `vite.config.js`.

## APIs utilisées

- `POST /api/v1/rcc/jobs` — analyser une liasse (même pipeline V6 que le scoring)
- `GET /api/v1/rcc/jobs/{id}/result` — résultat d'affichage (20 postes RCC + VA, EBE, CAF, etc.)
- `GET /api/v1/rcc/jobs/{id}/export` — JSON métier propre (`chiffre_affaires`, `valeur_ajoutee`, …)
- `GET /api/v1/rcc/dossiers/{id}` — écran de validation
- `GET /api/v1/rcc/dossiers/{id}/export.json` — même JSON propre, après corrections analyste
