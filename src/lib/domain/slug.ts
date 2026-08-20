/**
 * Identifiants lisibles, dérivés du nom saisi par un soignant.
 *
 * Les identifiants de lieux, de services et de catégories sont visibles dans les URL et
 * dans la base : « la-joncquerelle » se relit et se corrige, « k3Jd82nQ » non. Ils sont
 * stables une fois créés — renommer un lieu ne change pas son identifiant, sinon les
 * activités qui le désignent pointeraient dans le vide.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    // Retire les accents, sans toucher aux lettres elles-mêmes.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Ajoute un suffixe tant que l'identifiant est déjà pris. */
export function uniqueSlug(value: string, existing: Iterable<string>): string {
  const pris = new Set(existing)
  const base = slugify(value) || 'sans-nom'
  if (!pris.has(base)) return base
  for (let i = 2; i < 100; i += 1) {
    const candidat = `${base}-${i}`
    if (!pris.has(candidat)) return candidat
  }
  return `${base}-${Date.now()}`
}
