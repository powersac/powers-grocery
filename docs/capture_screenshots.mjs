/**
 * Screenshot the live grocery list for the README.
 *
 *   CAPTURE_URL=$(grep -v '^#' .env.capture | cut -d= -f2-) npm run capture
 *
 * Regenerable on purpose: a screenshot that cannot be rebuilt rots the moment
 * the UI changes, and a stale screenshot is a lie about the product.
 *
 * Shoots the LIVE Worker, not a fixture. The list's real contents are what
 * makes the shot legible; an invented list reads as a mockup.
 *
 * The URL carries the auth token in its path, so it comes from the environment
 * and never from this file.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const IMAGES = "docs/images";

// { name, width, height, before }
// `before` runs against the page before the shot, for shots that need the app
// put into a particular state first.
//
// Widths are phone widths on purpose: this is an installed-to-home-screen PWA
// and a 1280px-wide shot of it would misrepresent how it is actually used.
//
// Heights are MEASURED, not guessed. Re-measure rather than re-guess if a shot
// ever starts cutting off the content its alt text promises.
//
// The live page loads with the "To buy" filter (#f-buy) active by default,
// not "Everything" (#f-all), discovered 2026-09-17 when a first capture run
// with `before: null` on both shots produced two byte-identical PNGs. Each
// shot below now clicks its filter button explicitly rather than relying on
// whichever filter happens to be the current default.
//
// Measured 2026-09-17 against the live list at 420px wide, via Step 5's probe
// script extended to click each filter first:
//   #f-buy ("To buy", 4 items):        #rows bottom = 515.4375
//   #f-all ("Everything", 68 items):   #rows bottom = 4398.609375 (8 aisles;
//     document.body.scrollHeight for this state is 5520, still excluding the
//     unrelated #dinners section further down the page)
// list.png uses a deliberate partial crop of the "Everything" state rather
// than its full 4398px content height: a README hero shot several phone
// screens tall would misrepresent the app more than a clean 2-aisle preview
// does. The crop still ends on a measured aisle boundary (2nd aisle bottom =
// 1177.90625, rounded up to 1180), not a guess, so it never cuts a row in
// half. to-buy.png's 520 clears the measured 515.4375 #rows bottom exactly.
const SHOTS = [
  {
    name: "list.png",
    width: 420,
    height: 1180,
    before: async (page) => {
      await page.click("#f-all");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "to-buy.png",
    width: 420,
    height: 520,
    before: async (page) => {
      await page.click("#f-buy");
      await page.waitForTimeout(300);
    },
  },
];

function targetUrl() {
  const url = process.env.CAPTURE_URL;
  if (!url) {
    console.error(
      "CAPTURE_URL is not set. Copy .env.capture.example to .env.capture,\n" +
        "fill in the real URL, then:\n" +
        "  CAPTURE_URL=$(grep -v '^#' .env.capture | cut -d= -f2-) npm run capture",
    );
    process.exit(1);
  }
  return url;
}

async function main() {
  const url = targetUrl();

  const probe = await fetch(url, { redirect: "follow" }).catch((e) => {
    console.error(`${url.replace(/\/[^/]+$/, "/<token>")} is not answering: ${e.message}`);
    process.exit(1);
  });
  if (!probe.ok) {
    console.error(
      `${url.replace(/\/[^/]+$/, "/<token>")} returned HTTP ${probe.status}. ` +
        "Check the token and that the Worker is deployed.",
    );
    process.exit(1);
  }

  await mkdir(IMAGES, { recursive: true });

  // Launched headless rather than attached over CDP to a running Chrome: the
  // reference implementation documents the CDP-attached browser stalling
  // inside Page.captureScreenshot for every shot.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const shot of SHOTS) {
      // A clip cannot exceed the viewport, so the viewport is sized to this
      // shot rather than shared: a shorter viewport silently clamps the
      // screenshot to its own height instead of the requested one.
      const page = await browser.newPage({
        viewport: { width: shot.width, height: shot.height },
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#rows", { state: "visible", timeout: 15000 });
      await page.waitForTimeout(1000);
      if (shot.before) await shot.before(page);
      const out = path.join(IMAGES, shot.name);
      await page.screenshot({
        path: out,
        clip: { x: 0, y: 0, width: shot.width, height: shot.height },
      });
      console.log(`wrote ${out}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
