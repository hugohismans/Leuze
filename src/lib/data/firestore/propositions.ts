/**
 * Une idée d'activité, telle que Firestore la range.
 *
 * La conversion vit ici, à la frontière, et pas dans les deux adapters : le patient lit
 * les siennes, l'administrateur les lit toutes, et les deux doivent en tirer exactement
 * le même objet. Deux conversions séparées auraient fini par diverger sur un champ
 * facultatif — et la moitié de ces champs porte une réponse écrite à quelqu'un.
 */
import type { ActivityProposal } from '../../domain/proposals'

/** Ce que Firestore rend d'un horodatage. On n'impose pas le type du SDK à ce module. */
type Horodatage = { toDate?: () => Date }

export function versProposition(id: string, data: Record<string, unknown>): ActivityProposal {
  const quand = data['createdAt'] as Horodatage | undefined
  const decide = data['decidedAt'] as Horodatage | undefined
  const motif = data['declineReason']
  const activite = data['activityId']
  return {
    id,
    patientUid: (data['patientUid'] as string | undefined) ?? '',
    ...(typeof data['patientFirstName'] === 'string' && data['patientFirstName'] !== ''
      ? { patientFirstName: data['patientFirstName'] }
      : {}),
    title: (data['title'] as string | undefined) ?? '',
    description: (data['description'] as string | undefined) ?? '',
    wantsToLead: data['wantsToLead'] === true,
    status: (data['status'] as ActivityProposal['status'] | undefined) ?? 'proposed',
    // Une date illisible ne doit pas faire disparaître l'idée de la file : elle remonte
    // alors tout en haut, là où on la verra.
    createdAt: quand?.toDate?.() ?? new Date(0),
    ...(decide?.toDate === undefined ? {} : { decidedAt: decide.toDate() }),
    ...(typeof motif === 'string' && motif !== '' ? { declineReason: motif } : {}),
    ...(typeof activite === 'string' && activite !== '' ? { activityId: activite } : {}),
  }
}
