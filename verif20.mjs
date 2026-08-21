import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const U = 'http://localhost:4328'
const connecter = async (p) => {
  await p.goto(`${U}/#/soignant`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  await p.getByLabel(/Adresse/).fill('soignant@exemple.test')
  await p.getByLabel(/Mot de passe/).fill('demonstration')
  await p.getByRole('button', { name: 'Se connecter' }).click()
  await p.waitForTimeout(1500)
}
const tel = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
tel.on('pageerror', (e) => console.log('ERREUR:', e.message))
await connecter(tel)
console.log('TÉLÉPHONE — en-tête soignant :', Math.round((await tel.locator('header').boundingBox()).height), 'px')
await tel.screenshot({ path: 'tel-final.png' })
await tel.goto(`${U}/#/`, { waitUntil: 'networkidle' })
await tel.waitForTimeout(1200)
console.log('TÉLÉPHONE — en-tête patient :', Math.round((await tel.locator('header').boundingBox()).height), 'px (inchangé)')

const bureau = await b.newPage({ viewport: { width: 1440, height: 900 } })
await connecter(bureau)
await bureau.screenshot({ path: 'bureau-final.png' })
// L'impression du programme
await bureau.goto(`${U}/#/soignant/impression`, { waitUntil: 'networkidle' })
await bureau.waitForTimeout(1200)
await bureau.emulateMedia({ media: 'print' })
await bureau.waitForTimeout(400)
console.log('IMPRESSION — colonnes :', (await bureau.locator('.programme').evaluate(el => getComputedStyle(el).gridTemplateColumns)).split(' ').length)
console.log('IMPRESSION — navigation :', await bureau.locator('#tiroir-soignant').evaluate(el => getComputedStyle(el).display))
console.log('IMPRESSION — décalage de page :', await bureau.locator('.application').evaluate(el => getComputedStyle(el).paddingInlineStart))
await b.close()
