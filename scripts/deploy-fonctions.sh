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

if npx firebase deploy --only functions --project "$PROJET"; then
  ouvre
  vert "Fonctions déployées."
  exit 0
fi

rouge "Une partie des fonctions n'est pas passée — seconde tentative."
if npx firebase deploy --only functions --project "$PROJET"; then
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
