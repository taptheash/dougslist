# Doug's List — Alexa skill setup

What you'll be able to say:

- "Alexa, tell dougs app to add milk" → Market Basket (the default)
- "Alexa, tell dougs app to add light bulbs to Lowe's"
- "Alexa, tell dougs app to add two cans of diced tomatoes" → saved as "2 Cans of diced tomatoes"
- "Alexa, tell dougs app to remove eggs from Target"
- "Alexa, ask dougs app what's on Market Basket"

It works with Market Basket, Target, Lowe's, and any custom stores you've created. Removing works on recipe-driven Market Basket items too (it does the same thing as tapping remove in the app).

Files:

- `functions/api/alexa.js`: the endpoint
- `worker.js`: one new route, `/api/alexa/...`
- `alexa/interaction-model.json`: paste this into the Alexa console

Do the steps in order. Each step has a test, so if something breaks, we know exactly where.

---

## Step 1: Deploy and check that it can reach Firestore

1. Make up a long random secret. In Git Bash:

   ```
   openssl rand -hex 16
   ```

   Save the output somewhere. It goes into the endpoint URL so nobody else can call it.

2. Add the secret to the Worker. In the Cloudflare dashboard, go to **Workers & Pages → dougslist → Settings → Variables and Secrets → Add**:
   - Type: **Secret**
   - Name: `ALEXA_PATH_SECRET`
   - Value: the hex string from above

3. Commit and push (or deploy the way you normally do).

4. **Test:** while signed in to the app, open this in your browser:

   ```
   https://dougslist.taptheash.us/api/alexa/<YOUR-SECRET>/health
   ```

   - ✅ You should see something like `{"ok":true,"stores":["Market Basket","Target","Lowe's",...]}`
   - ❌ If you see `{"ok":false,"error":"...PERMISSION_DENIED..."}`, your Firestore rules are blocking it. Send me the error.
   - ❌ If you see "Not found", the secret in the URL doesn't match the one you saved in step 2.

## Step 2: Let Alexa get past Cloudflare Access

Alexa can't log in through the Access email gate, so this one path needs a bypass. The rest of the app stays protected.

1. Go to the **Cloudflare Zero Trust dashboard → Access → Applications → Add an application → Self-hosted**.
2. Name it `dougslist-alexa`. For the domain, enter `dougslist.taptheash.us` with the path `api/alexa`.
3. Add a policy: Action **Bypass**, Include **Everyone**. Save.

**Test:** open the health URL from Step 1 in a **private/incognito window**. You should get the same JSON, not the Access login page.

## Step 3: Create the skill

1. Go to <https://developer.amazon.com/alexa/console/ask> and sign in with the **same Amazon account your Echo uses**.
2. **Create Skill**:
   - Name: `Doug's List`
   - Locale: **English (US)** (must match your Echo's language)
   - Type: **Custom**
   - Hosting: **Provision your own**
   - Template: **Start from scratch**
3. In the left menu, go to **Interaction Model → JSON Editor**. Replace everything with the contents of `alexa/interaction-model.json`. Click **Save**, then **Build skill**, and wait for "Build successful."
4. Go to **Endpoint** (left menu):
   - Choose **HTTPS**
   - Default Region: `https://dougslist.taptheash.us/api/alexa/<YOUR-SECRET>`
   - SSL certificate: **"My development endpoint has a certificate from a trusted certificate authority"**
   - Click **Save**
5. Copy the **Skill ID** shown at the top of the Endpoint page (`amzn1.ask.skill.…`).
6. Back in Cloudflare (**Variables and Secrets**), add a second **Secret**:
   - Name: `ALEXA_SKILL_ID`
   - Value: the skill ID

   Once it's set, the endpoint only answers your skill.

## Step 4: Test in the simulator

1. In the Alexa console, open the **Test** tab and switch "Skill testing is enabled in" from Off to **Development**.
2. Type: `tell dougs app to add milk`
   - ✅ Alexa replies "Added Milk to Market Basket," and Milk appears in the app.
   - The JSON Output panel on the right shows exactly what the endpoint sent back.

## Step 5: Try it on the Echo

Say: "Alexa, tell dougs app to add milk."

The skill appears automatically on every Echo registered to your Amazon account. You don't need to enable it. You'll find it in the Alexa app under **More → Skills & Games → Your Skills → Dev**.

---

## If something goes wrong

- **Live logs.** From the dougslist folder in Git Bash, run `npx wrangler tail dougslist`, then talk to Alexa. Every request and error shows up there.
- **Errors are spoken.** The skill says what failed ("Firestore said permission denied," "I couldn't sign in to Firebase") instead of giving Alexa's generic "problem with the skill's response."
- **"I couldn't find a store called …"** means Alexa heard a store name that doesn't match any of your stores. Saying it closer to how the store is named in the app usually fixes it.

## Notes

- **Firebase sign-in.** The endpoint signs in to Firebase anonymously, the same way the app does, so your existing Firestore rules apply unchanged. You may see a few extra anonymous users in Firebase Auth over time. They're harmless.
- **Request checks.** Only requests with the secret URL, your skill ID, and a timestamp less than 150 seconds old are accepted. Amazon's full request-signature check only matters if you publish the skill publicly, which you won't for a personal dev skill.
