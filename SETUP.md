# Powers grocery list, hosted

One page, two links, a real shared database. The planner's link (CARTER_TOKEN)
can plan; the partner's link (PARTNER_TOKEN) shops. When either of you ticks
something, it is gone for both.

## What you are deploying

- **A Cloudflare Worker** that serves the page and a small API.
- **A KV namespace** holding one JSON blob: the catalog, what is on the list, and
  the next ten days of dinners.

Free tier covers this many times over. Two people tapping a grocery list is a
rounding error against 100,000 reads a day.

## Setup, once, about ten minutes

You need a free Cloudflare account and Node installed.

**1. Log in**

    cd powers-grocery
    npx wrangler login

**2. Make the database**

    npx wrangler kv namespace create LIST

It prints an id. Open `wrangler.toml` and paste it over `PASTE_YOUR_KV_NAMESPACE_ID`.

**3. Set the three secrets**

Run each one and paste a long random value when prompted, for example the output
of `openssl rand -hex 16`. Keep them somewhere safe; they are the links.

    npx wrangler secret put CARTER_TOKEN
    npx wrangler secret put PARTNER_TOKEN
    npx wrangler secret put ADMIN_TOKEN

**4. Deploy**

    npx wrangler deploy

It prints your URL, something like `https://<your-subdomain>.workers.dev`.

**5. Load the starting list**

    node seed.js > seed.json
    npx wrangler kv key put --binding=LIST state --path=seed.json --remote

**6. Open your link**

    https://<your-subdomain>.workers.dev/<CARTER_TOKEN>

The partner's link is the same URL with PARTNER_TOKEN instead. Both should add to the home
screen: three dots, Add to Home screen. It behaves like an app after that.

## Day to day

- Tap an item to cross it off. It disappears for both of you within fifteen seconds,
  or instantly if the other person pulls Refresh.
- Type in the Add box to add anything. It files it in the right aisle by itself.
- Wrong aisle? Tap Everything, then ⇄ on the item, and pick the right one. It stays there.
- Dinners sit under the list with hands-on minutes and what to do.
- Carter's link also gets a pencil on each dinner, a down arrow to swap two days,
  and an × in Everything to delete something from the catalog for good.

## If something goes wrong

**"This link does not work."** The token was cut short when copied. They are long.

**The banner says it cannot reach the list.** Cloudflare or the network is down.
Nothing is lost; the page shows what it last loaded and recovers on its own.

**Start over.** Re-run step 5. It overwrites the whole state.

**Rotate a link.** `npx wrangler secret put PARTNER_TOKEN` with a new value. The old
link stops working immediately.

## Security, honestly

The link is the password. Anyone with it can read and change the list. That is the
right trade for a grocery list and the wrong one for anything sensitive, so do not
put anything else in here. The page asks not to be indexed and not to pass the URL
on in referrer headers, and the tokens are 32 random characters, which is not
guessable. But treat the link the way you would treat a house key.

## Changing the code

`worker.js` is generated. Edit the files in `src/` and run `node build.js`.

    node test-ops.js     # the list rules
    node test-api.js     # auth, roles, races, bad input
    node test-e2e.js     # two phones in a real browser DOM

All three must pass before you deploy.
