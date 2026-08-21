import { describe, expect, it } from 'vitest'
import { patientIdentityOf } from './session'

describe('qui est connecté', () => {
  it('reconnaît un patient à son jeton', () => {
    expect(patientIdentityOf('p_1', { patient: true, serviceId: 'le-mazurel' })).toEqual({
      patientUid: 'p_1',
      serviceId: 'le-mazurel',
    })
  })

  it('ne prend pas un soignant pour un patient', () => {
    // Le cas qui a mis un soignant sur l'écran patient, sans issue.
    expect(patientIdentityOf('uid-soignant', { role: 'admin' })).toBeNull()
    expect(patientIdentityOf('uid-soignant', { role: 'staff' })).toBeNull()
  })

  it('refuse un jeton sans personne', () => {
    expect(patientIdentityOf(null, { patient: true })).toBeNull()
    expect(patientIdentityOf('p_1', null)).toBeNull()
  })

  it('n’accepte que le vrai « oui », pas une valeur qui y ressemble', () => {
    expect(patientIdentityOf('p_1', { patient: 'true' })).toBeNull()
    expect(patientIdentityOf('p_1', { patient: 1 })).toBeNull()
  })

  it('tolère un patient sans service : il verra ce qui est ouvert à tous', () => {
    expect(patientIdentityOf('p_1', { patient: true })).toEqual({ patientUid: 'p_1', serviceId: null })
    expect(patientIdentityOf('p_1', { patient: true, serviceId: '' })).toEqual({ patientUid: 'p_1', serviceId: null })
  })
})
