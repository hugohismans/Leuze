#!/usr/bin/env bash
#
# Autorise les fonctions à fabriquer une session pour un patient.
#
# `createCustomToken` doit signer un jeton. Sur Cloud Run, les fonctions n'ont pas de clé
# privée : elles demandent la signature à Google, par l'API « IAM Service Account
# Credentials ». Deux choses sont nécessaires, et aucune n'est posée par défaut :
#   1. l'API doit être activée sur le projet ;
#   2. le compte de service des fonctions doit avoir le droit de signer *pour lui-même*
#      (rôle « Créateur de jetons »).
#
# Sans cela, l'échange d'un code patient échoue sur un « INTERNAL » sans explication —
# et seulement pour un code valable, puisqu'un code inconnu est refusé avant la signature.
set -uo pipefail

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"
REGION="europe-west1"

vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }

if ! command -v gcloud >/dev/null 2>&1; then
  rouge "La commande « gcloud » est introuvable. Lancez ce script depuis Cloud Shell."
  exit 1
fi

echo "1/3  Activation de l'API de signature"
if gcloud services enable iamcredentials.googleapis.com --project="$PROJET" --quiet 2>&1; then
  vert "     Activée."
else
  rouge "     Échec de l'activation."
  exit 1
fi

echo "2/3  Compte de service des fonctions"
COMPTE=$(gcloud run services describe exchangecode --region="$REGION" --project="$PROJET" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)
if [ -z "$COMPTE" ]; then
  # Une fonction déployée sans compte explicite tourne sous le compte Compute par défaut.
  NUMERO=$(gcloud projects describe "$PROJET" --format='value(projectNumber)' 2>/dev/null)
  [ -n "$NUMERO" ] && COMPTE="$NUMERO-compute@developer.gserviceaccount.com"
fi
if [ -z "$COMPTE" ]; then
  rouge "     Compte introuvable. La fonction « exchangeCode » est-elle déployée ?"
  exit 1
fi
vert "     $COMPTE"

echo "3/3  Droit de signer ses propres jetons"
if sortie=$(gcloud iam service-accounts add-iam-policy-binding "$COMPTE" \
  --member="serviceAccount:$COMPTE" --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJET" --quiet 2>&1); then
  vert "     Accordé."
else
  rouge "     Échec :"
  echo "$sortie" | head -12
  exit 1
fi

echo
vert "Terminé. Comptez une minute avant que le droit soit pris en compte, puis"
echo "réessayez d'entrer un code patient."
