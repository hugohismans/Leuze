<script lang="ts">
  import { staffStore } from '../../lib/staffState.svelte'
  import { router } from '../../lib/router.svelte'
  import ActivitiesPage from './ActivitiesPage.svelte'
  import ActivityFormPage from './ActivityFormPage.svelte'
  import StaffLoginPage from './StaffLoginPage.svelte'
  import StaffNav from './StaffNav.svelte'
  import TodayPage from './TodayPage.svelte'

  staffStore.restore()

  const activityId = $derived(
    router.path.startsWith('/soignant/activite/')
      ? router.path.slice('/soignant/activite/'.length)
      : null,
  )
</script>

{#if !staffStore.signedIn}
  <StaffLoginPage />
{:else}
  <StaffNav />
  {#if activityId !== null}
    <ActivityFormPage {activityId} />
  {:else if router.path === '/soignant/activites'}
    <ActivitiesPage />
  {:else}
    <TodayPage />
  {/if}
{/if}
