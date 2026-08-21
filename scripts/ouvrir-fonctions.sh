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
# On applique le droit à chacune, ce qui est sans effet quand il est déjà là.
set -euo pipefail

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"
REGION="europe-west1"
RACINE="$(dirname "$(dirname "$(readlink -f "$0")")")"

vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }

# Seules les fonctions appelées depuis le navigateur. Le déclencheur Firestore et la
# tâche planifiée sont invoqués par Google avec un compte de service : les ouvrir serait
# une faute.
APPELABLES=$(grep -oE '^export const [A-Za-z0-9_]+ = onCall' "$RACINE/functions/src/index.ts" | awk '{print $3}')

if [ -z "$APPELABLES" ]; then
  rouge "Aucune fonction appelable trouvée — le script n'a rien fait."
  exit 1
fi

echo "Ouverture des fonctions appelables du projet $PROJET :"
for nom in $APPELABLES; do
  service=$(echo "$nom" | tr '[:upper:]' '[:lower:]')
  if gcloud run services add-iam-policy-binding "$service" \
    --region="$REGION" --member=allUsers --role=roles/run.invoker \
    --project="$PROJET" --quiet >/dev/null 2>&1; then
    printf '  %-24s ouverte\n' "$nom"
  else
    printf '  %-24s ' "$nom"
    rouge "échec — la fonction existe-t-elle ?"
  fi
done

vert "Terminé. Les appels depuis le navigateur sont à nouveau acceptés."
