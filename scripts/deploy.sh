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
# Vérification directe : ce dossier contient-il bien le dernier état publié sur GitHub ?
# Elle attrape toutes les causes de retard d'un coup — origine mal réglée, branche
# configurée sur le dépôt local (« From . »), simple oubli de mettre à jour. Trois
# déploiements de suite ont publié une version périmée sans que rien ne le signale.
git fetch "$DEPOT" main --quiet 2>/dev/null || true
if [ -n "$(git rev-parse --verify FETCH_HEAD 2>/dev/null)" ] &&
   ! git merge-base --is-ancestor FETCH_HEAD HEAD 2>/dev/null; then
  printf '\n\033[0;31m%s\033[0m\n' "Ce dossier est en retard sur GitHub."
  echo "Mettez-le à jour, puis relancez :"
  echo "  git pull $DEPOT main && bash scripts/deploy.sh"
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
# Au tout premier déploiement, les API Cloud Build et Cloud Run viennent d'être activées
# et une partie des fonctions échoue à se créer. Une seconde passe suffit presque
# toujours ; au-delà, c'est une vraie erreur et il faut la lire.
if ! npm run deploy:fonctions; then
  rouge "Une partie des fonctions n'est pas passée — seconde tentative."
  if ! npm run deploy:fonctions; then
    rouge "Les mêmes fonctions échouent : ce n'est pas un aléa."
    cat <<'AIDE'

La cause la plus fréquente est le quota de CPU de Cloud Run dans la région, qu'un projet
neuf a bas. Pour lire la vraie raison :

  npx firebase deploy --only functions --debug 2>&1 | grep -iA4 "quota\|denied\|error:" | head -40

Et pour voir les quotas de la région :
  https://console.cloud.google.com/iam-admin/quotas?project=leuze-d23b5&service=run.googleapis.com

AIDE
    exit 1
  fi
fi

# Sans politique de nettoyage, les images de construction s'accumulent et finissent par
# coûter quelques centimes par mois. Trois jours suffisent largement.
npx firebase functions:artifacts:setpolicy --days 3 --force --project "$PROJET" >/dev/null 2>&1 || true

bleu "6/6  Catalogue et application"
# Services, lieux, catégories, motifs de rendez-vous. Aucune donnée de démonstration.
GCLOUD_PROJECT="$PROJET" npm run init:catalogue -- --confirmer

npm run build:app
# On vérifie ce qu'on s'apprête à publier plutôt que de faire confiance au drapeau :
# la version de démonstration a déjà été publiée une fois sur le vrai projet, et rien
# ne l'avait signalé. La configuration Firebase n'existe que dans la vraie version.
if ! grep -rlq "firebaseapp.com" dist/assets/*.js 2>/dev/null; then
  rouge "La version construite n'est pas branchée sur Firestore — publication annulée."
  echo "Vérifiez que « npm run build:app » a bien tourné, puis relancez."
  exit 1
fi
vert "Version vérifiée : branchée sur Firestore."
npx firebase deploy --only hosting --project "$PROJET"

bleu "Terminé."
# Le script de promotion vise « demo-leuze » par défaut, c'est-à-dire l'émulateur :
# sans GCLOUD_PROJECT, il chercherait le compte dans une base qui n'existe pas.
cat <<FIN
Il reste une chose, à faire une seule fois :

  1. Créez votre compte dans la console Firebase → Authentication → Ajouter un
     utilisateur (adresse + mot de passe) :
     https://console.firebase.google.com/project/$PROJET/authentication/users
  2. Donnez-lui le rôle administrateur, depuis ce dossier :

       GCLOUD_PROJECT=$PROJET npm run promote:admin -- votre.adresse@exemple.be

  3. Reconnectez-vous dans l'application : le rôle ne prend effet qu'au prochain
     jeton.

L'application est en ligne sur https://$PROJET.web.app
FIN
