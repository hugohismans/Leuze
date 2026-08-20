/**
 * Configuration Web du projet Firebase.
 *
 * Ces valeurs sont **publiques par nature** : elles partent dans le navigateur de chaque
 * visiteur, c'est le fonctionnement normal de Firebase. Ce qui protège les données, ce
 * sont les règles de `firestore.rules`, pas la confidentialité de ces clés. Elles sont
 * donc versionnées ici, pour que l'application se construise à l'identique sur n'importe
 * quelle machine, sans fichier à recréer à la main.
 *
 * Ce qui ne doit JAMAIS être versionné : une clé de compte de service (fichier JSON
 * contenant `private_key`), qui contourne toutes les règles, et le poivre des codes
 * patients, qui vit dans `firebase functions:secrets`.
 *
 * Un fichier `.env` local peut redéfinir chaque valeur (voir `.env.example`), pour
 * pointer vers un second projet sans toucher au code.
 */
export const firebaseOptions = {
  apiKey: 'AIzaSyBOsXHkT2G6GviG1o4i4qMgnZolyeLndC0',
  authDomain: 'leuze-d23b5.firebaseapp.com',
  projectId: 'leuze-d23b5',
  storageBucket: 'leuze-d23b5.firebasestorage.app',
  messagingSenderId: '629808465446',
  appId: '1:629808465446:web:3bf1d14cd955c5b81248e7',
  // `measurementId` est volontairement absent : pas de Google Analytics dans cette
  // application (voir CLAUDE.md, « hors sujet »). Aucune mesure d'audience tierce ne
  // doit observer la navigation d'un patient hospitalisé.
} as const
