# AceDialer Mobile — Start Here (Plain-English Groundwork)

This is your non-technical guide. It explains, in everyday language, what needs to happen *before* anyone writes a line of mobile-app code. You don't need to do anything technical yourself — your job is to get the right accounts created and make a few business decisions. I'll walk you through each one when you're ready.

Think of it like building a house: before construction, you need the land, the permits, and a few design choices. That's what this is.

---

## The big picture (why we're not coding yet)

We finished the planning and audited your existing AceDialer app. The honest finding: **the behind-the-scenes "engine" (the backend) isn't ready for phones yet.** A few important pieces simply don't exist today, and they have to be built first or the phone apps won't work properly (for example, incoming calls won't ring when the phone is in your pocket).

So the order is: **(1) get accounts + decisions → (2) build the missing engine pieces → (3) then build the actual iOS and Android apps.** This guide is step 1.

---

## Part A — Accounts ApTask needs to own

These are like the "storefronts" and toolkits. The most important rule: **ApTask the company must own all of these — never a personal Apple ID, a developer's personal account, or an outside vendor.** Otherwise ApTask could lose control of its own app later.

These are like the "storefronts" and toolkits. The most important rule: **ApTask the company must own all of these — never a personal Apple ID or an outside vendor.**

| # | What | Status | Cost | Notes |
|---|------|--------|------|-------|
| 1 | **Apple Developer account** | ✅ **Done — ApTask has it** | ~$99/year | Already in place. |
| 2 | **Telnyx account** | ✅ **Done — ApTask owns it, paid** | Already paying | Already in place. |
| 3 | **Code repository** | ✅ **Done — Abd's, with Claude's assistance** | — | Already in place. |
| 4 | **Google Play Console account (Organization)** | ⬜ **Still to do** | ~$25 one-time | Needed only for the Android app. A few days to verify business details. |
| 5 | **Firebase account** | ⬜ **Still to do** | Free for our needs | Needed only for Android, so Android phones can receive call/message alerts. Set up under an ApTask Google account. |

**Bottom line:** the iPhone side is fully covered on accounts. The only two accounts left are **Google Play** and **Firebase**, and both are Android-only — so they're not urgent until we start Android.

---

## Part B — Your AI team (no humans to hire)

You don't need to staff up. I've created a team of AI agents that fill these roles. Each one has a clear job, strict safety rules, and a requirement to get your approval before doing anything risky. You talk to me; I direct the team and report back to you in plain English.

| Agent (the "role") | What it does for you | Status |
|---|---|---|
| **ace-backend-mobile-agent** | The backend engineer. Builds the missing "engine" pieces (the biggest job). | ✅ Created |
| **ace-ios-mobile-agent** | The iPhone app builder. | ✅ Created |
| **ace-android-mobile-agent** | The Android app builder. | ✅ Created |
| **ace-compliance-agent** | The store + legal compliance reviewer (privacy disclosures, calling/texting consent rules, keeping us out of the rejection pile). | ✅ Created |
| **ace-web-pages-agent** | Writes and prepares the required public web pages (Privacy, Terms, Support, "delete my account"). | ✅ Created |

All five live in the project at `.claude/agents/`. They coordinate with each other on the shared parts (the connection between app and engine, the rules, the wording).

**Two honest limits where a human still matters — and that's normal:**
- The **compliance agent drafts** legal/consent wording, but a **licensed attorney should sign off** before it goes public. The agent will clearly flag exactly what needs a lawyer's eyes — it won't be a guessing game.
- The web-pages agent can **build and prepare** the pages, but **publishing them to a live web address** is a quick action someone with access to your website/hosting performs (or grants me access to do). The agent hands over a ready-to-publish package plus simple instructions.

Everything else — the actual building, testing, and store preparation — the AI team handles.

---

## Part C — A few business decisions (no tech knowledge needed)

I'll explain each in plain terms when you're ready, but here's the gist so you can think ahead:

1. **First version: outgoing calls only, or incoming too?**
   Building incoming calls (so the app rings when someone calls you) is the hardest part on phones. My recommendation: **launch with outgoing calls, texting, voicemail, and history first**, then add incoming calls in a fast follow-up. This gets you live sooner. (Your call.)

2. **How the apps are built — "native" vs. "shared code."**
   *Native* means a separate, top-quality build for iPhone and for Android. *Shared code* means one codebase for both, which is cheaper but riskier for a calling app. My recommendation: **native**, because calling apps are exactly where the shared approach tends to cause problems. (I'll explain the trade-off simply when you decide.)

3. **What "delete my account" should do.**
   The stores require users to be able to delete their account from inside the app. We need to decide whether that fully erases their data or just disables the login, and how long to keep records. This needs a quick legal opinion.

4. **Who is the attorney who signs off the legal wording?**
   The compliance agent will draft the privacy/terms/consent text, but one human attorney (ApTask's counsel) should approve it before it goes live. I just need to know who that is when we get there.

---

## Part D — One thing to fix soon (security)

During the audit I found that some **secret passwords and keys are accidentally saved inside the project's files** (the kind of thing that should never be shared). This isn't a mobile problem specifically — it affects the current app too — and it's worth fixing regardless. The fix is for a developer to **change those passwords/keys and remove them from the files.** I did **not** touch anything; I'm just flagging it. I can write a simple plain-English instruction sheet for your developer if you'd like.

---

## What happens next (your simple checklist)

When you're ready to move, here's the order I'd suggest. Don't worry about the "how" — I'll guide each step, and the AI team does the building.

- [x] **Apple Developer account** — already in place ✅
- [x] **Telnyx account** — already in place, paid ✅
- [x] **Code repository** — already in place ✅
- [x] **The AI team** — backend, iOS, Android, compliance, web-pages agents created ✅
- [ ] 1. Make the **business decisions** in Part C (mainly: outgoing-first vs. incoming too; native vs. shared)
- [ ] 2. Tell me your **attorney** for the legal sign-off (only needed before pages go public)
- [ ] 3. Get the **secrets fixed** in the existing project (Part D) — I can prep this for you
- [ ] 4. **Google Play + Firebase** accounts — Android-only, so only when we start Android
- [ ] 5. Green-light the **backend agent** to build the missing engine pieces
- [ ] 6. Then the **app agents** build iOS/Android, the **web-pages agent** preps the pages, and the **compliance agent** readies the store submissions

You don't need to do all of this now — you said "later," and that's fine. This page is just so the groundwork is mapped out and nothing surprises you. The accounts you just confirmed (Apple, Telnyx, repo) are checked off above.

**When you want to start any item, just tell me which one and I'll walk you through it in plain steps.**
