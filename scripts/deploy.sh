#!/usr/bin/env bash
#
# Mise en service complète, en une commande — pensée pour être lancée depuis
# Google Cloud Shell, y compris sur un téléphone.
#
#   bash scripts/deploy.sh
#
# Le script est idempotent : le relancer ne casse rien et ne réécrit pas ce qu'un
# soignant a modifié depuis. Il ne détruit jamais de données.
set -euo pipefail

bleu() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"

bleu "1/6  Vérification de l'accès à Firebase"
if ! npx --yes firebase projects:list >/dev/null 2>&1; then
  rouge "Vous n'êtes pas connecté à Firebase."
  echo "Lancez d'abord :  npx firebase login --no-localhost"
  echo "puis relancez ce script."
  exit 1
fi
vert "Connecté. Projet visé : $PROJET"

bleu "2/6  Installation des dépendances"
npm ci
npm --prefix functions ci

bleu "3/6  Règles de sécurité et index"
# Remplace immédiatement le « mode test », qui laisse la base ouverte à tous.
npm run deploy:regles

bleu "4/6  Poivre des codes patients"
if npx firebase functions:secrets:access CODE_PEPPER --project "$PROJET" >/dev/null 2>&1; then
  vert "Déjà défini — inchangé."
else
  # Généré ici, jamais affiché, jamais écrit dans le dépôt : il ne sert qu'aux
  # fonctions, qui le lisent depuis le gestionnaire de secrets.
  openssl rand -base64 48 | tr -d '\n' |
    npx firebase functions:secrets:set CODE_PEPPER --project "$PROJET" --data-file - >/dev/null
  vert "Créé."
fi

bleu "5/6  Cloud Functions"
npm run deploy:fonctions

bleu "6/6  Catalogue et application"
# Services, lieux, catégories, motifs de rendez-vous. Aucune donnée de démonstration.
GCLOUD_PROJECT="$PROJET" npm run init:catalogue -- --confirmer
npm run deploy:app

bleu "Terminé."
cat <<'FIN'
Il reste une chose, à faire une seule fois :

  1. Créez votre compte dans la console Firebase → Authentication → Ajouter un
     utilisateur (adresse + mot de passe).
  2. Donnez-lui le rôle administrateur :

       npm run promote:admin -- votre.adresse@exemple.be

L'application est en ligne sur https://leuze-d23b5.web.app
FIN
