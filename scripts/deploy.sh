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
DEPOT="https://github.com/hugohismans/Leuze"

# Cloud Shell clone parfois depuis une copie locale : « git pull » répond alors
# « Already up to date » sans jamais aller sur GitHub. On le signale plutôt que de
# déployer une version périmée sans s'en rendre compte.
ORIGINE="$(git remote get-url origin 2>/dev/null || echo '')"
if [ -n "$ORIGINE" ] && [ "$ORIGINE" != "$DEPOT" ] && [ "$ORIGINE" != "$DEPOT.git" ]; then
  printf '\n\033[0;31m%s\033[0m\n' "Ce dossier ne suit pas GitHub (origine : ${ORIGINE:-aucune})."
  echo "Remettez-le d'aplomb, puis relancez :"
  echo "  git remote set-url origin $DEPOT && git pull origin main"
  exit 1
fi

# Les dépendances d'abord : c'est elles qui apportent le CLI Firebase.
# Attention, le paquet « firebase » est le SDK client, sans exécutable ; le CLI
# s'appelle « firebase-tools ». Lancé depuis le dépôt, « npx firebase » prend le bon.
bleu "1/6  Installation des dépendances"
npm ci
npm --prefix functions ci

bleu "2/6  Accès à Firebase"
if ! npx firebase projects:list >/dev/null 2>&1; then
  # Connexion menée ici plutôt que renvoyée à l'utilisateur : sur un téléphone,
  # chaque commande à retaper est une occasion de se tromper.
  echo "Connexion nécessaire. Ouvrez l'adresse affichée, puis recopiez le code ici."
  npx firebase login --no-localhost
fi
npx firebase projects:list >/dev/null 2>&1 || {
  rouge "La connexion n'a pas abouti. Relancez le script."
  exit 1
}
vert "Connecté. Projet visé : $PROJET"

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
