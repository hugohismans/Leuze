#!/usr/bin/env bash
#
# Déploiement des Cloud Functions, avec une seconde tentative.
#
# Une partie des fonctions échoue régulièrement à se mettre à jour du premier coup : le
# quota de processeur de Cloud Run dans la région est bas sur un projet neuf, et dix-huit
# fonctions déployées ensemble le frôlent. Une seconde passe suffit presque toujours.
# Relancer à la main depuis un téléphone est pénible : le script le fait.
set -euo pipefail

PROJET="${GCLOUD_PROJECT:-leuze-d23b5}"
rouge() { printf '\033[0;31m%s\033[0m\n' "$*"; }
vert() { printf '\033[0;32m%s\033[0m\n' "$*"; }

# La session du CLI Firebase expire au bout de quelques heures. Sans cette vérification,
# le script tentait de déployer deux fois, échouait deux fois sur la même raison, puis
# reposait des droits pour rien — trois écrans d'erreurs pour un mot de passe à redonner.
if ! npx firebase projects:list --project "$PROJET" >/dev/null 2>&1; then
  rouge "La session Firebase a expiré."
  cat <<AIDE

Reconnectez-vous, puis relancez cette commande :

  npm run connexion

Une adresse s'affiche : ouvrez-la, choisissez votre compte Google, puis collez le code
obtenu dans le fichier « code-firebase.txt » à l'aide de l'éditeur Cloud Shell. Le
script le récupère tout seul — rien à coller dans le terminal, où le collage est
souvent impossible depuis un téléphone.

AIDE
  exit 1
fi

# Journal de la dernière tentative : on y relit ce que Firebase a refusé de faire.
JOURNAL="$(mktemp)"
trap 'rm -f "$JOURNAL"' EXIT

deployer() {
  npx firebase deploy --only functions --project "$PROJET" 2>&1 | tee "$JOURNAL"
  return "${PIPESTATUS[0]}"
}

# Une fonction retirée du code n'est pas supprimée toute seule.
#
# La publication ne se contente pas de l'ignorer : elle **s'arrête**, et rien ne part —
# ni les autres fonctions, ni le site. C'est un garde-fou de Firebase, et il a raison sur
# le principe : effacer une fonction en ligne parce qu'elle a disparu du code demande une
# décision. Mais cette décision a déjà été prise, dans le commit qui l'a retirée.
#
# On ne passe donc pas « --force » à la publication entière — ce serait dire oui d'avance
# à tout ce qu'elle voudra effacer. On lit les noms que Firebase vient d'écrire, on
# supprime ceux-là et pas d'autres, puis on republie.
#
# Au-delà de trois, on s'arrête : trois fonctions retirées d'un coup est plausible, dix
# ne l'est pas — c'est le signe qu'une construction a mal tourné, et l'on préfère une
# publication ratée à un projet vidé.
supprimer_les_disparues() {
  local noms
  noms=$(grep -oE 'functions:delete [A-Za-z0-9_-]+' "$JOURNAL" | awk '{print $2}' | sort -u | tr '\n' ' ')
  noms="${noms% }"
  [ -z "$noms" ] && return 1

  local combien
  combien=$(wc -w <<<"$noms")
  if [ "$combien" -gt 3 ]; then
    rouge "$combien fonctions ont disparu du code d'un coup — c'est trop pour être voulu."
    rouge "Rien n'est supprimé. Vérifiez la construction avant de republier."
    return 1
  fi

  rouge "Fonctions retirées du code, à effacer du projet : $noms"
  # shellcheck disable=SC2086
  npx firebase functions:delete $noms --region europe-west1 --project "$PROJET" --force
  vert "Effacées. On republie."
  return 0
}

ouvre() {
  # Une fonction reprise après un échec perd son droit d'être appelée depuis le
  # navigateur. On le repose systématiquement : c'est sans effet quand il est déjà là.
  GCLOUD_PROJECT="$PROJET" bash "$(dirname "$0")/ouvrir-fonctions.sh" || true
  # Et le droit de signer les sessions des patients, jamais posé par défaut. Il est
  # accordé une fois pour toutes par « connecter-github.sh » : la publication
  # automatique n'a donc pas besoin des droits que cela demanderait.
  if [ "${LEUZE_SANS_JETONS:-}" != "1" ]; then
    GCLOUD_PROJECT="$PROJET" bash "$(dirname "$0")/autoriser-jetons.sh" || true
  fi
}

if deployer; then
  ouvre
  vert "Fonctions déployées."
  exit 0
fi

# Cas particulier, et prioritaire : la publication s'est arrêtée sans rien tenter parce
# qu'une fonction a disparu du code. Une seconde tentative échouerait pour la même raison.
if supprimer_les_disparues; then
  if deployer; then
    ouvre
    vert "Fonctions déployées après avoir effacé celles qui ont été retirées du code."
    exit 0
  fi
fi

rouge "Une partie des fonctions n'est pas passée — seconde tentative."
if deployer; then
  ouvre
  vert "Fonctions déployées à la seconde tentative."
  exit 0
fi

# Même après un échec partiel, les fonctions qui sont passées doivent être joignables.
ouvre

rouge "Les mêmes fonctions échouent : ce n'est plus un aléa."
cat <<AIDE

Pour lire la vraie raison :

  npx firebase deploy --only functions --debug 2>&1 | grep -iA4 "quota\|denied\|error:" | head -40

Et pour voir les quotas de la région :
  https://console.cloud.google.com/iam-admin/quotas?project=$PROJET&service=run.googleapis.com

AIDE
exit 1
