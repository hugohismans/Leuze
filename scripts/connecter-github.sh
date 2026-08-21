#!/usr/bin/env bash
#
# Autorise GitHub à déployer, une fois pour toutes.
#
# Aucune clé n'est créée ni téléchargée : GitHub prouve son identité à Google par un
# jeton signé (« Workload Identity Federation »), et Google n'accepte que les jetons
# venant de ce dépôt précis. Il n'y a donc rien à voler dans le dépôt, rien à faire
# tourner, rien qui expire.
#
#   bash scripts/connecter-github.sh
#
# Relancer le script ne casse rien : chaque étape est sans effet si elle est déjà faite.
set -uo pipefail

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"
DEPOT="hugohismans/Leuze"
RESERVOIR="github"
FOURNISSEUR="leuze"
COMPTE="deploiement-github"

bleu() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }

if ! command -v gcloud >/dev/null 2>&1; then
  rouge "La commande « gcloud » est introuvable. Lancez ce script depuis Cloud Shell."
  exit 1
fi

NUMERO=$(gcloud projects describe "$PROJET" --format='value(projectNumber)' 2>/dev/null)
if [ -z "$NUMERO" ]; then
  rouge "Projet $PROJET introuvable, ou session gcloud expirée."
  exit 1
fi
ADRESSE="$COMPTE@$PROJET.iam.gserviceaccount.com"

bleu "1/5  Activation des services nécessaires"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com \
  cloudresourcemanager.googleapis.com --project="$PROJET" --quiet >/dev/null 2>&1 &&
  vert "     Fait." || { rouge "     Échec."; exit 1; }

bleu "2/5  Compte de service du déploiement"
if gcloud iam service-accounts describe "$ADRESSE" --project="$PROJET" >/dev/null 2>&1; then
  vert "     Existe déjà : $ADRESSE"
else
  gcloud iam service-accounts create "$COMPTE" --project="$PROJET" \
    --display-name="Déploiement depuis GitHub" --quiet >/dev/null 2>&1 &&
    vert "     Créé : $ADRESSE" || { rouge "     Échec."; exit 1; }
fi

bleu "3/5  Droits du compte de déploiement"
# Le strict nécessaire pour publier : les règles, les fonctions, l'hébergement, et de
# quoi reposer le droit d'appel des fonctions après chaque publication.
for role in \
  roles/firebase.admin \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/cloudbuild.builds.builder \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageAdmin \
  roles/secretmanager.admin; do
  printf '  %-42s ' "$role"
  if gcloud projects add-iam-policy-binding "$PROJET" \
    --member="serviceAccount:$ADRESSE" --role="$role" --quiet >/dev/null 2>&1; then
    vert "accordé"
  else
    rouge "échec"
  fi
done

bleu "4/5  Confiance accordée à ce dépôt, et à lui seul"
if ! gcloud iam workload-identity-pools describe "$RESERVOIR" --location=global \
  --project="$PROJET" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$RESERVOIR" --location=global \
    --display-name="GitHub" --project="$PROJET" --quiet >/dev/null 2>&1
fi
if gcloud iam workload-identity-pools providers describe "$FOURNISSEUR" --location=global \
  --workload-identity-pool="$RESERVOIR" --project="$PROJET" >/dev/null 2>&1; then
  vert "     Déjà en place."
else
  # La condition est la sécurité de tout l'édifice : un jeton venant d'un autre dépôt
  # est rejeté par Google, avant même d'atteindre le compte de service.
  gcloud iam workload-identity-pools providers create-oidc "$FOURNISSEUR" \
    --location=global --workload-identity-pool="$RESERVOIR" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$DEPOT'" \
    --project="$PROJET" --quiet >/dev/null 2>&1 &&
    vert "     Créée." || { rouge "     Échec."; exit 1; }
fi

gcloud iam service-accounts add-iam-policy-binding "$ADRESSE" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/$RESERVOIR/attribute.repository/$DEPOT" \
  --project="$PROJET" --quiet >/dev/null 2>&1 &&
  vert "     $DEPOT peut désormais déployer." || rouge "     Échec de l'autorisation du dépôt."

bleu "5/5  Droit de signer les sessions des patients"
bash "$(dirname "$0")/autoriser-jetons.sh" >/dev/null 2>&1 &&
  vert "     Déjà fait ou accordé." || rouge "     À relancer : npm run autoriser:jetons"

bleu "Terminé."
cat <<FIN
Ce que GitHub utilisera, déjà inscrit dans le dépôt — rien à recopier :

  Fournisseur : projects/$NUMERO/locations/global/workloadIdentityPools/$RESERVOIR/providers/$FOURNISSEUR
  Compte      : $ADRESSE

À partir de maintenant, chaque modification poussée sur « main » est publiée
automatiquement. Vous pouvez suivre chaque publication ici :

  https://github.com/$DEPOT/actions
FIN
