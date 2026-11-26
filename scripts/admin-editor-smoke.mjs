// Drives the Payload admin of the dev app in a real browser: the part the component tests mock away. The preview field redraws
// the card when `useAllFormFields` reports a change (src/client/OgPreviewField.tsx); only a browser on the real admin shows that
// the hook still fires on the Payload major under test. Called by scripts/probe-dev-server.mjs with the running app, an editor
// and a post. It logs in over the login endpoint (the browser keeps the cookie), opens the post, edits the title and counts the
// `POST /api/payload-og-image/preview` requests the page makes. Nothing is saved.
//
// Chromium: `playwright-core install chromium` (CI does it in .github/actions/playwright-chromium). `PROBE_BROWSER_CDP=<url>` drives
// an already running browser over CDP instead of launching one (a fresh context, closed at the end).
import { chromium } from 'playwright-core'

const PREVIEW = '/api/payload-og-image/preview'
const DEBOUNCE_MS = 800 // OgPreviewField's DEBOUNCE_MS: the quiet window after the last change
const QUIET_MS = DEBOUNCE_MS + 1200 // long enough for a stray second request to show up
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `cond` until it is truthy; calls `fail` (which throws) with `what` at the deadline. */
async function poll(cond, what, ms, fail) {
  for (const deadline = Date.now() + ms; ; await sleep(50)) {
    const value = await cond()
    if (value) return value
    if (Date.now() > deadline) fail(`admin: timed out waiting for ${what}`)
  }
}

export async function adminEditorSmoke({ origin, email, password, post, ok, check, eq, fail }) {
  const until = (cond, what, ms = 15_000) => poll(cond, what, ms, fail)
  const cdp = process.env.PROBE_BROWSER_CDP
  const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const previews = [] // each preview request: when, its JSON body, and the response once it arrives
  const trace = []
  const previewOf = new Map()
  page.on('console', (m) => m.type() === 'error' && trace.push(`console.error: ${m.text()}`))
  page.on('pageerror', (e) => trace.push(`pageerror: ${e.message}`))
  page.on('request', (r) => {
    if (new URL(r.url()).pathname !== PREVIEW) return
    const entry = { at: Date.now(), body: r.postDataJSON(), method: r.method() }
    previews.push(entry)
    previewOf.set(r, entry)
    trace.push(`preview #${previews.length}`)
  })
  page.on('response', (res) => {
    const entry = previewOf.get(res.request())
    if (entry) entry.response = { status: res.status(), type: res.headers()['content-type'] }
  })
  const img = page.locator('img[alt="Preview of the share card"]')
  const drawn = () => img.evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false)

  try {
    const login = await context.request.post(`${origin}/api/users/login`, { data: { email, password } })
    eq(login.status(), 200, 'admin: the editor logged in (the browser holds the cookie)')

    await page.goto(`${origin}/admin/collections/posts/${post.id}`, { waitUntil: 'domcontentloaded' })
    const title = page.locator('#field-title')
    await title.waitFor({ state: 'visible' })
    eq(await title.inputValue(), post.title, 'admin: the post opened in the editor with its saved title')

    // 1. One preview on load, and no second one after the form settles.
    await until(() => previews.length >= 1, 'the preview request on load')
    await sleep(QUIET_MS)
    eq(previews.length, 1, 'admin: exactly one preview POST on load')
    const [onLoad] = previews
    eq(onLoad.body.collection, 'posts', 'admin: the preview asks for the posts collection')
    eq(String(onLoad.body.id), String(post.id), 'admin: the preview asks for the open document')
    eq(onLoad.body.doc?.title, post.title, 'admin: the preview carries the form data (the saved title)')
    await until(() => onLoad.response, 'the preview response on load')
    eq(onLoad.response.status, 200, 'admin: the preview answered 200')
    check(onLoad.response.type?.startsWith('image/'), `admin: the preview answered an image (${onLoad.response.type})`)
    await until(drawn, 'the preview image to load')
    const firstSrc = await img.getAttribute('src')
    check(firstSrc?.startsWith('blob:'), 'admin: the card preview <img> shows the drawn card (blob URL, naturalWidth > 0)')

    // 2. Quick edits are one request, sent only after the quiet window.
    await title.click()
    await title.press('End')
    await title.pressSequentially(' edited', { delay: 100 })
    const lastKey = Date.now()
    eq(previews.length, 1, 'admin: no preview POST while the title is still being typed (debounced)')
    await until(() => previews.length >= 2, 'the preview request after the edit', 5_000)
    check(
      previews[1].at - lastKey >= DEBOUNCE_MS - 150,
      `admin: the preview came ${previews[1].at - lastKey} ms after the last keystroke (debounce ${DEBOUNCE_MS} ms)`,
    )
    await sleep(QUIET_MS)
    eq(previews.length, 2, 'admin: seven quick keystrokes made exactly one preview POST')
    eq(previews[1].body.doc?.title, `${post.title} edited`, 'admin: the preview carries the edited title')
    await until(() => previews[1].response, 'the preview response after the edit')
    eq(previews[1].response.status, 200, 'admin: the preview after the edit answered 200')
    check(previews[1].response.type?.startsWith('image/'), `admin: it answered an image (${previews[1].response.type})`)
    await until(async () => (await drawn()) && (await img.getAttribute('src')) !== firstSrc, 'the preview image to be redrawn')
    ok('admin: the card preview <img> shows the redrawn card (a new blob URL)')

    // 3. "Force new image" adds 1 to og.nonce, which is a change like any other.
    const force = page.getByRole('button', { name: 'Force new image' })
    eq(await force.count(), 1, 'admin: the "Force new image" button is present')
    check(await force.isEnabled(), 'admin: the "Force new image" button is enabled for a generated card')
    await force.click()
    await until(() => previews.length >= 3, 'the preview request after "Force new image"', 5_000)
    eq(previews[2].body.doc?.og?.nonce, 1, 'admin: "Force new image" sent og.nonce 1')
    await sleep(QUIET_MS)
    eq(previews.length, 3, 'admin: "Force new image" made exactly one preview POST')
  } catch (error) {
    console.error(`--- admin editor trace ---\npage: ${page.url()}\nrequests seen: ${previews.length}\n${trace.slice(-30).join('\n')}`)
    throw error
  } finally {
    await context.close()
    await browser.close()
  }
}
