<script lang="ts">
  import logo from '../../lib/brand/acis-logo-bleu.svg'
  import { staffStore } from '../../lib/staffState.svelte'
  import { programmeCount, weekProgramme } from '../../lib/domain/programme'
  import { addLocalDays, formatDayLabel, startOfIsoWeek, todayLocalDate } from '../../lib/domain/time'
  import WeekProgramme from '../../lib/ui/WeekProgramme.svelte'

  /**
   * La feuille affichée dans l'unité — celle qui remplace le tableau papier.
   *
   * Elle est établie par service : les activités ouvertes à tous, plus celles réservées
   * au service choisi. Elle ne contient **aucun nom de patient** : c'est un programme,
   * pas une liste d'inscrits, et elle est destinée à un mur.
   */
  let serviceId = $state<string | null>(null)

  const programme = $derived(weekProgramme(staffStore.week, staffStore.occurrences, serviceId))
  const total = $derived(programmeCount(programme))
  const service = $derived(staffStore.catalog.services.find((s) => s.id === serviceId) ?? null)

  const semaineDe = (decalage: number): void => {
    staffStore.date = addLocalDays(startOfIsoWeek(staffStore.date), decalage * 7)
    void staffStore.refresh()
  }
</script>

<section class="mx-auto max-w-[1600px] px-4 py-6">
  <!-- Les réglages ne s'impriment pas : seule la feuille part à l'imprimante. -->
  <div class="no-print mb-5 card p-4">
    <h1 class="mb-3 text-3xl font-bold text-ink">Imprimer le programme</h1>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label for="service" class="mb-2 block text-lg font-semibold text-ink">Pour quel service ?</label>
        <select
          id="service"
          class="w-full rounded-xl border-2 border-line bg-white p-3 text-lg text-ink"
          style="min-height: 56px;"
          value={serviceId ?? ''}
          onchange={(event) => (serviceId = event.currentTarget.value === '' ? null : event.currentTarget.value)}
        >
          <option value="">Tous les services — le programme complet</option>
          {#each staffStore.catalog.services as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
        <p class="mt-2 text-base text-ink-soft">
          La feuille contiendra les activités ouvertes à tous, plus celles réservées à ce service.
        </p>
      </div>

      <div>
        <p class="mb-2 text-lg font-semibold text-ink">Quelle semaine ?</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-secondary" onclick={() => semaineDe(-1)}>
            <span aria-hidden="true">←</span> Précédente
          </button>
          {#if startOfIsoWeek(staffStore.date) !== startOfIsoWeek(todayLocalDate())}
            <button type="button" class="btn btn-secondary" onclick={() => { staffStore.date = todayLocalDate(); void staffStore.refresh() }}>
              Cette semaine
            </button>
          {/if}
          <button type="button" class="btn btn-secondary" onclick={() => semaineDe(1)}>
            Suivante <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" class="btn btn-primary" onclick={() => window.print()}>
        <span aria-hidden="true">🖨️</span> Imprimer cette feuille
      </button>
      <p class="text-base text-ink-soft">
        Format paysage conseillé. {total} activité{total > 1 ? 's' : ''} sur la feuille.
      </p>
    </div>
  </div>

  <!-- La feuille elle-même, telle qu'elle sortira de l'imprimante. -->
  <article class="feuille rounded-xl border-2 border-line bg-white p-5">
    <header class="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-line pb-3">
      <div>
        <h2 class="text-3xl font-bold text-ink">Les activités de la semaine</h2>
        <p class="text-lg text-ink">
          Du {formatDayLabel(staffStore.week[0]!)} au {formatDayLabel(staffStore.week[6]!)}
          {#if service}— {service.name}{/if}
        </p>
      </div>
      <img src={logo} alt="ACIS" class="h-10 w-auto" />
    </header>

    {#if total === 0}
      <p class="text-lg text-ink-soft">Aucune activité prévue cette semaine.</p>
    {:else}
      <WeekProgramme {programme} />
    {/if}

    <footer class="mt-4 border-t-2 border-line pt-3 text-base text-ink">
      Pour vous inscrire à une activité à places limitées, demandez votre code à un soignant,
      puis connectez-vous sur la tablette de l'unité.
    </footer>
  </article>
</section>
