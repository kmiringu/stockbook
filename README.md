# Stockbook

Simple stock control for a small store. People record what they take by scanning a QR code at the store and tapping a few buttons. The record lives in a Google Sheet that the owner can open at any time, and the owner gets email updates.

Built for Fundi Kanga, Gikambura.

## How it works

```
 Store QR code ──► phone page (GitHub Pages) ──► Google Sheet (Apps Script)
   scan            tap name → product →            Moves · Products · People
                   took / brought back →            Summary · Settings
                   amount → Record                      │
                                                        └─► emails to the owner
```

- **Nothing to remember.** Tap your name (the phone remembers it), tap the product, set the amount with + / −, then tap Record. Big and small units (for example boxes and packets) are both buttons.
- **Works with weak signal.** Records are kept on the phone and sent automatically once the network returns, with the time the stock was actually taken.
- **Mistakes can be undone** by the same person within 30 minutes. Nothing is deleted; the record is marked `void` in the sheet.
- **Owner emails.** An evening email on days when stock moved, and a Monday report with stock value, slow movers and the week's movements.
- **Private.** This repo holds only code. Stock data stays in the Google Sheet. The QR link carries a store key, and changing the key in Settings locks out old links.

## Set up (about 15 minutes, once)

1. Create a Google Sheet in the owner's Google account, or share it with the owner later.
2. Open **Extensions → Apps Script**, replace everything with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. Select **`setup`** in the function list, click **Run** and allow access. This creates the tabs Summary, Settings, Products, People and Moves.
4. Click **Deploy → New deployment → ⚙ Web app**. Set *Execute as*: **Me** and *Who has access*: **Anyone**, then click Deploy and copy the URL.
5. In the sheet's **Settings** tab, set the store name, paste the URL into *Web app URL* and add the owner's email under *Owner emails*.
6. **Products** tab: replace the example rows with your products, how they're packed, opening counts and prices.
   **People** tab: add everyone who takes stock.
7. Open the *Store link* from Settings on your phone, tap **QR code for the store door**, then print it and stick it up.

When `Code.gs` changes, paste the new version, save and run **`updateTriggers`** once. Only use **Deploy → Manage deployments → Edit → New version** (which keeps the same URL) when the change affects the phone page's backend (`doGet`/`doPost`).

## Daily life

| Who | What |
|---|---|
| Anyone taking stock | Scan → name → product → amount → Record. About 10 seconds. |
| Anyone returning stock | Same steps, but tap "I brought back". |
| Storekeeper | Records new deliveries. Does a **stock count** every week (tap "New delivery or stock count…"), which catches anything not recorded. |
| Owner | Reads the emails and opens the sheet's **Summary** tab whenever needed. |

## Using it for another business

Make a new Google Sheet, paste `Code.gs`, run `setup` and fill in the Products and People tabs. The same page works for any store, because the QR link says which sheet to use.

## What's here

- `apps-script/Code.gs`: the Google Sheet backend (setup, web app and emails)
- `docs/index.html`: the phone page people open from the QR code
- `docs/rods.html`: a public product and price page for customers
