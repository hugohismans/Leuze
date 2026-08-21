"""
Connexion au CLI Firebase quand on ne peut pas coller dans le terminal.

Sur un téléphone, la console Cloud Shell refuse le collage : impossible d'y déposer le
code d'autorisation, long d'une centaine de caractères. L'éditeur, lui, accepte le
collage. Ce script fait le pont : il lance la connexion, affiche l'adresse à ouvrir,
puis surveille un fichier. Dès que le code y apparaît, il le transmet à la connexion.

    python3 scripts/connexion-firebase.py

Le terminal doit rester ouvert pendant l'opération.
"""

import os
import pty
import select
import sys
import time

FICHIER = os.path.join(os.getcwd(), "code-firebase.txt")
COMMANDE = ["npx", "firebase", "login", "--reauth", "--no-localhost"]

BLEU = "\033[1;34m"
VERT = "\033[0;32m"
FIN = "\033[0m"


def consignes() -> None:
    print(f"\n{BLEU}Comment faire, sans rien coller dans le terminal{FIN}")
    print("  1. Ouvrez l'adresse affichée ci-dessus dans un onglet, choisissez votre")
    print("     compte Google, puis copiez le code obtenu.")
    print("  2. Dans l'éditeur Cloud Shell — l'icône crayon en haut à droite — ouvrez")
    print(f"     le fichier :  {FICHIER}")
    print("  3. Collez le code dedans et enregistrez (Fichier → Enregistrer).")
    print("\nLe reste est automatique : ce script attend le fichier.\n")


def main() -> int:
    # Créé vide pour être visible dans l'éditeur avant même que le code n'existe.
    with open(FICHIER, "w", encoding="utf-8") as f:
        f.write("")

    pid, maitre = pty.fork()
    if pid == 0:
        os.execvp(COMMANDE[0], COMMANDE)
        return 1

    envoye = False
    consignes_affichees = False
    debut = time.monotonic()

    while True:
        pret, _, _ = select.select([maitre], [], [], 0.5)
        if pret:
            try:
                donnees = os.read(maitre, 4096)
            except OSError:
                break
            if not donnees:
                break
            sys.stdout.write(donnees.decode("utf-8", "replace"))
            sys.stdout.flush()
            # Les consignes viennent après l'adresse, sinon elles défilent trop tôt.
            if not consignes_affichees and b"authorization code" in donnees:
                consignes()
                consignes_affichees = True

        if not envoye:
            try:
                with open(FICHIER, encoding="utf-8") as f:
                    code = f.read().strip()
            except OSError:
                code = ""
            if code:
                print(f"\n{VERT}Code reçu — transmission…{FIN}\n")
                os.write(maitre, (code + "\n").encode())
                envoye = True
            elif time.monotonic() - debut > 900:
                print("\nRien n'est arrivé en quinze minutes. Relancez la commande.")
                break

        fini, statut = os.waitpid(pid, os.WNOHANG)
        if fini:
            # On vide ce qui reste avant de rendre la main.
            while select.select([maitre], [], [], 0.2)[0]:
                try:
                    reste = os.read(maitre, 4096)
                except OSError:
                    break
                if not reste:
                    break
                sys.stdout.write(reste.decode("utf-8", "replace"))
            sys.stdout.flush()
            # Le code d'autorisation n'a plus lieu d'être : il ouvre une session.
            try:
                os.remove(FICHIER)
            except OSError:
                pass
            return os.waitstatus_to_exitcode(statut)


if __name__ == "__main__":
    sys.exit(main() or 0)
