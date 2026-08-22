<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { router } from '../../lib/router.svelte'
  import ActivitiesPage from './ActivitiesPage.svelte'
  import AttendancePage from './AttendancePage.svelte'
  import WeekPage from './WeekPage.svelte'
  import PrintPage from './PrintPage.svelte'
  import MeetingPage from './MeetingPage.svelte'
  import StaffAppointmentsPage from './AppointmentsPage.svelte'
  import PatientsPage from './PatientsPage.svelte'
  import PersonnelPage from './PersonnelPage.svelte'
  import ImpersonatePage from './ImpersonatePage.svelte'
  import ActivityFormPage from './ActivityFormPage.svelte'
  import CatalogPage from './CatalogPage.svelte'
  import PatientWeekPage from './PatientWeekPage.svelte'
  import PlanningsPage from './PlanningsPage.svelte'
  import ProposalsPage from './ProposalsPage.svelte'
  import PractitionerWeekPage from './PractitionerWeekPage.svelte'
  import StaffLoginPage from './StaffLoginPage.svelte'
  import StaffNav from './StaffNav.svelte'
  import TodayPage from './TodayPage.svelte'

  staffStore.restore()

  /** `/soignant/activite/nouvelle/2026-08-25` : le second segment est la date choisie. */
  const segments = $derived(
    router.path.startsWith('/soignant/activite/')
      ? router.path.slice('/soignant/activite/'.length).split('/')
      : [],
  )
  const activityId = $derived(segments[0] ?? null)

  // Un compte rendu ne doit pas suivre le soignant d'un onglet à l'autre.
  $effect(() => {
    void router.path
    staffStore.clearMessageOnNavigation()
  })
  const dateChoisie = $derived(segments[1])
</script>

{#if !staffStore.signedIn}
  <StaffLoginPage />
{:else}
  <StaffNav />
  {#if activityId !== null}
    <ActivityFormPage {activityId} date={dateChoisie} />
  {:else if router.path === '/soignant/activites'}
    <ActivitiesPage />
  {:else if router.path === '/soignant/catalogue'}
    <CatalogPage />
  {:else if router.path === '/soignant/reunion'}
    <MeetingPage />
  {:else if router.path === '/soignant/patients'}
    <PatientsPage />
  {:else if router.path === '/soignant/personnel'}
    <PersonnelPage />
  {:else if router.path === '/soignant/a-leur-place'}
    <ImpersonatePage />
  {:else if router.path === '/soignant/idees'}
    <ProposalsPage />
  {:else if router.path === '/soignant/rendez-vous'}
    <StaffAppointmentsPage />
  {:else if router.path === '/soignant/plannings'}
    <PlanningsPage />
  {:else if router.path.startsWith('/soignant/appel/')}
    <AttendancePage occurrenceId={router.path.slice('/soignant/appel/'.length)} />
  {:else if router.path.startsWith('/soignant/intervenant/')}
    <PractitionerWeekPage practitionerId={router.path.slice('/soignant/intervenant/'.length)} />
  {:else if router.path.startsWith('/soignant/planning/')}
    <PatientWeekPage patientUid={router.path.slice('/soignant/planning/'.length)} />
  {:else if router.path === '/soignant/impression'}
    <PrintPage />
  {:else if router.path === '/soignant/aujourdhui'}
    <TodayPage />
  {:else}
    <WeekPage />
  {/if}
{/if}
