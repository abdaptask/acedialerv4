<!--
  User-facing guide to the Reports page. The shared, editable copy lives in
  Claude Docs: https://claude.ai/code/artifact/f15f05d6-2911-41d0-9800-c36d704d6c5a
  When a Reports tab, measure, end reason or entitlement changes (CLAUDE.md
  §31), update this file in the same change and copy the edit to the doc.
-->

# ACE Dialer Reports Guide

Sep 25, 2026 · Abdulla Sheikh

Reports shows how ApTask calls, texts and follows up with candidates. Recruiters see only their own numbers. Admins see everyone, plus Insights and spend. The server enforces this, so a recruiter can't open another person's report even with a copied link.

## Who sees what

| Area | Recruiters | Admins and leadership |
| --- | --- | --- |
| Overview, Calls, Missed & voicemail, Texts, Call quality, Outreach, Adoption | Your own numbers | Everyone, or any one person |
| Follow-ups | Your own open items | Every person's open items |
| Activity (each call and text) | Your own | Any one person's |
| Search a number or name | Your own history | The whole team's history |
| Insights (best time to call, overlap, opt-outs, failing numbers, movers) | Not shown | Yes |
| Cost (spend on calls, texts and lines) | Not shown | Yes |
| Daily email (compose, preview and send) | Not shown; you receive the team email | Yes |
| Person picker and team scorecard | Not shown | Yes |
| Export CSV | Your own data | Anything on screen |

Nobody sees the text of a message anywhere in Reports: texts appear as records only (when, who, delivered or not). Recordings and voicemail transcripts are not part of Reports.

## Getting started

Open Reports from your name menu (top right), or from Settings, then Reports. It works in the desktop app from version 0.10.232 and at dialer.aptask.com in any browser.

1. **Pick a date range.** Today, Yesterday, 7 days, 30 days, This month, Last month, or Custom (up to 92 days). Days and hours are Eastern time.
2. **Pick a tab.** Overview is the summary; each other tab goes deeper into one area.
3. **Click any number.** Every tile, bar and row opens what's behind it. On the team view it opens a ranking by person; on one person's report it opens the individual calls or texts.
4. **Click any call or text** to see the whole back-and-forth with that number, oldest first.

**Reading a tile.** The big number is this period. The small colored chip compares it with the previous period of the same length (30 days against the 30 days before). Green means better, red means worse. For rates such as answer rate, the chip is in points: 36% to 43% shows as "7 pts", not "19%".

**Counting rules.** Each call counts once, even though the carrier sends two records for most calls. Talk time runs from answer to hang-up, so ringing isn't counted. Numbers refresh every few minutes; the footer says when.

**Export CSV** downloads the table for the tab you're on. On Activity it downloads two files, one for calls and one for texts.

## For recruiters

Start each day on **Follow-ups**: it's the list of people waiting on you. Everything else helps you see where your time goes and what to change.

### A five-minute daily routine

1. **Follow-ups:** work the list from the top. The oldest items are first, and red means waiting more than 2 days. An item disappears as soon as you call or text that number back.
2. **Overview, set to Yesterday:** check your calls, talk time, and how many missed calls you returned.
3. **Activity, Unanswered filter:** anyone who called you and didn't reach you.

### What each tab does for you

| Tab | Use it to |
| --- | --- |
| Follow-ups | Return missed calls, answer texts waiting on you, and call back voicemails, oldest first. Covers the last 14 days, whatever dates are picked |
| Overview | See your week or month at a glance, against your previous period |
| Calls | See how many different people you dialled (unique numbers), how long your calls run, and when you're busiest |
| Missed & voicemail | See how often you answer, how fast you call back, and callers who tried several times and never got through |
| Texts | See delivery and reply rates. Failed texts say why, such as a landline that can't receive texts |
| Call quality | Spot calls that failed, bad numbers, calls that dropped, and calls with no audio |
| Outreach | See how many different people you reached, and how many were new this period |
| Activity | Every call and text, with who, when, how long, and why it ended. Filter by direction or end reason, or search a number |

### Finding a candidate

Type a phone number (four or more digits) or a saved name in the search box at the top. You'll see every call, text and voicemail you've had with that number in the last 12 months, and whether they opted out of texts.

### Using your numbers to improve

- **Lots of calls under 10 seconds?** You're mostly reaching voicemail greetings or wrong numbers. Check the numbers on those records, or try the times on the Calls heatmap when you connect most.
- **Low answer rate on inbound?** Look at "Unanswered calls by hour" to see when you miss calls, and set call forwarding for those hours.
- **Missed calls not returned?** A same-day callback is the single easiest win; Follow-ups lists exactly who.
- **Texts failing?** "Can't receive texts" means a landline: call instead. "Blocked as possible spam" means slow down and vary the wording.
- **A call connected but you heard nothing?** Open it in Activity. "The other side sent no audio" is on their end; "their audio never reached you" is ours, so tell your admin with the time and number.

## For admins and leadership

Admins see the whole team, can open any person's report, and get three extra tabs: Insights, Daily email and Cost. Use the person picker (top right) or click any name to drill in; "Everyone" at the top left takes you back.

### A weekly review in ten minutes

1. **Overview, 7 days:** scan the tiles for red chips, then sort the Team scorecard by the column you care about.
2. **Follow-ups:** the "By person" table shows who has the most people waiting and for how long. Anything older than 2 days is red.
3. **Insights:** check the biggest drops in calling, opt-outs with texts sent after them, and numbers that keep failing.
4. **Open two or three people:** their report compares every measure with the team average and their own previous period. Gaps of 15% or more are marked green or red.

### Drilling down

- Click any tile on the team view (Texts sent, Unique numbers dialled, Answer rate) to rank everyone by it, with each person's share or change.
- Click a person to open their report; click a tile there to see their individual calls or texts.
- In a person's list, **By day** groups each day by why calls ended (they hung up, no answer, busy, and so on), biggest group first. **By end reason** does the same for the whole period.
- Click any call or text to see the full conversation with that number, oldest first.
- Search any number to see which recruiters were in touch with it, and everything each of them did.

### Insights

| Panel | What it tells you | What to do with it |
| --- | --- | --- |
| When candidates pick up | The share of calls that reach a person for 30 seconds or more, by weekday and hour | Schedule call blocks in the best hours; avoid the worst |
| Biggest drops and increases | Change in calls out against the previous period, for people with 50 or more calls before | Check in with big drops early; learn from big increases |
| Candidates contacted by more than one person | Numbers two or more recruiters called or texted | Spot duplicated effort. A number dialled by a dozen people is usually a client switchboard, not poaching |
| Opt-outs (STOP) | People who texted STOP, and any texts sent to them afterwards | Any number above 0 in "Texts after" is a compliance issue to follow up the same day |
| Numbers that keep failing | Numbers "not found" two or more times | Fix the record in JobDiva |

### Daily email

Reports, Daily email (admins only) sends one team email about a working day: the people named in the shout-outs are on To, everyone else is on BCC, so nobody sees a long recipient list. It holds team numbers and shout-outs only; no individual's other numbers.

- **What's in it:** three shout-out boxes (most conversations, most people called, fastest callbacks), each with an icon, the winner, their number and the runners-up; team calls, different people called, conversations over 2 minutes and talk time, compared with the same weekday last week; how responsive the team was; a tip on the best hour to call the next working day. Never a bottom list.
- **Who gets it:** active users who called or texted in the last four weeks. "Show the recipients" lists them.
- **Sending:** pick the day, check the preview and the To list, send a test to yourself, then **Send to everyone** and confirm. A day already sent to everyone can only be sent again deliberately.
- **Automatic:** tick "Send automatically every weekday" and pick a time (5am to noon Eastern). It covers the previous working day, so Monday's covers Friday.
- **Sent:** the last 20 sends, with how many went out and who sent them.

### Cost

Cost estimates spend on calls (billed minutes), texts (billed message parts) and phone lines, per person and per line, with a monthly projection. It uses Telnyx list rates, so check the Telnyx invoice for exact charges. Recruiters never see this tab.

### Coaching with the numbers

- **Calls under 10 seconds above about 35%:** mostly voicemail greetings or wrong numbers; review the call list and the source of the numbers.
- **High likely-drop rate:** redialing the same number within 2 minutes. It can be a real drop or a habit; check Call quality and the end reasons.
- **Low return rate on missed calls:** the quickest fix is a daily pass through Follow-ups.
- **Low reply rate on texts:** open Activity, Texts, then "Waiting on reply".
- **Calls with no audio:** "the other side sent no audio" is on their end. "Their audio never reached you" is our connection: report it to IT with the time and number.

## What the terms mean

### Measures

| Term | Meaning |
| --- | --- |
| Outbound calls | Calls you placed, each counted once |
| Unique numbers dialled | Different phone numbers you called. Team-wide, a number two people called counts once |
| Connected | The call was answered (by a person or a voicemail system) |
| Talk time | From answer to hang-up; ringing isn't included |
| Average / median call length | Average talk time per connected call; the median is the middle call, which is less skewed by a few long ones |
| Calls under 10 seconds | Connected calls that lasted less than 10 seconds, usually a voicemail greeting or a wrong number |
| Conversations over 2 minutes | Connected calls of 2 minutes or more |
| Answer rate | Inbound calls answered, out of all inbound calls except blocked ones |
| Returned within 24h | A missed call followed by an outbound call to the same number within 24 hours |
| Likely drop | The same number called again within 2 minutes of a call that lasted 10 seconds or more. An estimate |
| Confirmed drop | A connected call ended by a network fault |
| Reply rate | Incoming texts answered within 24 hours. Several texts in a row count as one |
| Billed message parts | Long texts, or texts with emoji or curly quotes, are billed as several parts (admins only) |
| People reached | Different numbers you connected with by call or text |
| New contacts | People reached this period whom you hadn't contacted in the previous period |

### Why a call ended

| End reason | Meaning |
| --- | --- |
| You hung up / They hung up | Who ended a connected call |
| You hung up before they answered | You stopped the call while it was still ringing |
| No answer | It rang out on their side |
| Busy | Their line was busy |
| Number not in service or not found | The number doesn't exist or is disconnected. Fix the record |
| Declined or blocked by the other side | They rejected the call |
| Couldn't connect | A technical failure; the carrier's code is shown when there is one |
| Call dropped by the network | A connected call cut off without anyone hanging up |
| Connected, but the other side sent no audio | The carrier received no sound from their side |
| Connected, but their audio never reached you | The carrier heard them but your app received nothing. Report it with the time and number |
| Caller hung up while it rang / Nobody answered / You declined | The same, for inbound calls |

### Why a text wasn't delivered

| Status | Meaning |
| --- | --- |
| Delivered | The carrier confirmed it reached the phone |
| Sent, not confirmed | The carrier accepted it but never confirmed delivery |
| Can't receive texts | Usually a landline or a number not in service. Call instead |
| Blocked as possible spam | The carrier filtered it. Slow down, vary the wording, or call |
| Opted out (STOP) | The person asked not to be texted. Don't text them again unless they reply START |
| Not a valid phone number | The number is wrong on the record |

## Privacy and common questions

**Can anyone read my texts?** No. Reports never shows message text: it doesn't reach the page at all, so it can't appear on screen or in a CSV. Short incoming texts are checked on the server only to spot STOP and START.

**Who can see my numbers?** You and the admins. Other recruiters can't open your report.

**Why doesn't my number match what I remember?** Each call counts once and talk time excludes ringing, so totals can be lower than the older reports. Days run midnight to midnight Eastern time.

**Why are call quality and "no audio" blank for some calls?** Audio is measured from 25 September 2026 on. The app's own measurement needs desktop version 0.10.232 or later; update from your name menu, then Check for updates.

**Why does Follow-ups still list someone I spoke to?** It clears when you call or text that exact number back. If they called from a different number, contact that one too or it stays open.

**How far back can I look?** Any range of up to 92 days at a time. Search covers the last 12 months.

**Something looks wrong.** Note the tab, the date range and the number or person, and send it to your admin.
