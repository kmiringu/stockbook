# Stockbook

Simple stock control for a small store. People record what they take by scanning a QR code on the store door and tapping a few buttons. The record lives in a Google Sheet that the owner can open at any time, and the owner gets a summary email every evening.

It is first used at **Gikambura Office Store** for Fundi Kanga's import: Hero welding rods (279 boxes, of which Fundi Kanga took 2), body filler, grey primer and white spirit.

## How it works

```
 Store door QR ──► phone page (GitHub Pages) ──► Google Sheet (Apps Script)
   scan            tap name → product →            Moves · Products · People
                   took / brought back →            Summary · Settings
                   amount → Record                      │
                                                        └─► 6 pm email to the owner
```

- **Nothing to remember.** Tap your name (the phone remembers it), tap the product, set the amount with + / −, then tap Record. Boxes and packets are both buttons.
- **Works with weak signal.** Records are kept on the phone and sent automatically once the network returns, with the time the stock was actually taken.
- **Mistakes can be undone** by the same person within 30 minutes. Nothing is deleted; the record is marked `void` in the sheet.
- **Separate from WhatsApp chat.** The page has a "Copy summary for WhatsApp" button for anyone who wants to share the numbers.
- **Private.** The repo holds only code. Stock data stays in the Google Sheet. The QR link carries a store key, and changing the key in Settings locks out old links.

## Set up (about 15 minutes, once)

1. Create a Google Sheet (best in the owner's Google account, or share it with the owner later).
2. Open **Extensions → Apps Script**, replace everything with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. Select **`setup`** in the function list, click **Run** and allow access. This creates the tabs Summary, Settings, Products, People and Moves.
4. Click **Deploy → New deployment → ⚙ Web app**. Set *Execute as*: **Me** and *Who has access*: **Anyone**, then click Deploy and copy the URL.
5. In the sheet's **Settings** tab, paste the URL into *Web app URL* and add the owner's email under *Owner emails*.
6. **Products** tab: fill in the yellow cells (packing, opening count and price for filler, primer and spirit).
   **People** tab: add everyone who takes stock.
7. Open the *Store link* from Settings on your phone, tap **QR code for the store door**, then print it and stick it up.

If you change `Code.gs` later, paste the new version, save and run **`updateTriggers`** once. Only use **Deploy → Manage deployments → Edit → New version** (which keeps the same URL) when the change affects the phone page's backend (`doGet`/`doPost`).

## Daily life

| Who | What |
|---|---|
| Anyone taking stock | Scan → name → product → amount → Record. About 10 seconds. |
| Anyone returning stock | Same steps, but tap "I brought back". |
| Storekeeper or deputy | Records new deliveries. Does a **stock count** every Friday (tap "New delivery or stock count…"), which catches anything not recorded. |
| Owner | Gets a 6 pm email **only on days stock moved**, plus a **Monday 8 am weekly report** (stock value, slow movers, the week's movements). |

## Using it for another business

Make a new Google Sheet, paste `Code.gs`, run `setup` and edit the Products and People tabs. The same page works for any store, because the QR link says which sheet to use.

## Earlier version

`legacy-whatsapp/` contains the first attempt, which read stock movements out of a WhatsApp group chat. It was too fragile for a busy group that discusses other things too.
