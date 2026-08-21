#!/usr/bin/env bash
#
# Rend les fonctions appelables joignables depuis le navigateur.
#
# Une fonction « callable » de Firebase est publiquement invocable : c'est la fonction
# elle-même qui vérifie le jeton et refuse un inconnu — d'où `requireStaff` et
# `requirePatient` en tête de chacune. Firebase pose ce droit à la création ; mais quand
# une fonction échoue à se créer puis est reprise plus tard, le droit n'est pas reposé.
#
# Le symptôme est déroutant : Google refuse la requête avant la fonction, sans en-tête
# CORS, et le navigateur ne rapporte donc aucun code d'erreur — seulement « internal [0] ».
# Rien n'apparaît dans le journal non plus, puisqu'aucune fonction ne tourne.
set -uo pipefail

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"
REGION="europe-west1"
RACINE="$(dirname "$(dirname "$(readlink -f "$0")")")"

vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }

# Seules les fonctions appelées depuis le navigateur. Le déclencheur Firestore et les
# tâches planifiées sont invoqués par Google avec un compte de service : les ouvrir
# serait une faute.
APPELABLES=$(grep -oE '^export const [A-Za-z0-9_]+ = onCall' "$RACINE/functions/src/index.ts" | awk '{print $3}')
if [ -z "$APPELABLES" ]; then
  rouge "Aucune fonction appelable trouvée — le script n'a rien fait."
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  rouge "La commande « gcloud » est introuvable. Lancez ce script depuis Cloud Shell."
  exit 1
fi

echo "Projet : $PROJET — région : $REGION"
echo

echecs=0
premier_message=""
for nom in $APPELABLES; do
  service=$(echo "$nom" | tr '[:upper:]' '[:lower:]')
  printf '  %-24s ' "$nom"
  if sortie=$(gcloud run services add-iam-policy-binding "$service" \
      --region="$REGION" --member=allUsers --role=roles/run.invoker \
      --project="$PROJET" --quiet 2>&1); then
    vert "ouverte"
  else
    rouge "échec"
    echecs=$((echecs + 1))
    # La vraie raison, une seule fois : elle est identique pour toutes.
    [ -z "$premier_message" ] && premier_message="$sortie"
  fi
done

if [ -n "$premier_message" ]; then
  echo
  rouge "Raison du premier échec :"
  echo "$premier_message" | head -12
fi

# On ne se contente pas de croire gcloud : on refait le trajet du navigateur.
# Une réponse sans en-tête CORS signifie que Google a refusé avant la fonction.
echo
echo "Vérification, comme le ferait le navigateur :"
bloquees=0
for nom in $APPELABLES; do
  entetes=$(curl -s -D - -o /dev/null -m 20 -X POST \
    "https://$REGION-$PROJET.cloudfunctions.net/$nom" \
    -H 'Content-Type: application/json' \
    -H "Origin: https://$PROJET.web.app" \
    -d '{"data":{}}' 2>/dev/null)
  printf '  %-24s ' "$nom"
  if echo "$entetes" | grep -qi 'access-control-allow-origin'; then
    vert "joignable"
  else
    rouge "bloquée"
    bloquees=$((bloquees + 1))
  fi
done

echo
if [ "$bloquees" -eq 0 ]; then
  vert "Toutes les fonctions appelables répondent."
  exit 0
fi
rouge "$bloquees fonction(s) restent bloquées."
echo "Envoyez cette sortie : la raison du premier échec, ci-dessus, dit pourquoi."
exit 1
