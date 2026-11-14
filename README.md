# Stockbook

Stock control run from a WhatsApp group. Anyone in the group logs a movement with a short message. The storekeeper exports the chat, runs one command, and the ledger, the GitHub page and a summary for the group all update.

The first store using it is **Gikambura Office Store**, which holds Fundi Kanga's Hero welding rods: 279 boxes arrived, Fundi Kanga took 2, and 277 boxes (1,108 pkt) remain.

## Message format (pin this in the group)

| Message | Meaning |
|---|---|
| `#out 2 box hero for gate job` | 2 boxes taken out |
| `#out 3 pkt hero @Kamau` | 3 packets taken by Kamau, posted by someone else |
| `#return 1 pkt hero` | unused stock brought back |
| `#in 50 box hero` | new delivery |
| `#count 270 box hero` | stock take: the balance is set to this |

Rules: start the message with `#`, write the number as digits, and put the unit before the item. 1 box = 4 pkt. Messages without `#` are ignored, so normal chat is fine.

## Storekeeper routine (daily, about 2 minutes)

1. WhatsApp → group → ⋮ → More → Export chat → **Without media** → save the `.txt` to this folder.
2. `python3 stock.py sync "WhatsApp Chat with <group>.txt"`
3. Fix anything listed under "need attention" (a wrong item or a number written as a word). Ask the person to repost it, or log it by hand:
   `python3 stock.py log "#out 2 box hero" --by Kamau --at "2026-11-15 10:30"`
4. `python3 stock.py status`: paste the output back into the group.
5. `git add -A && git commit -m "stock: 15 Nov" && git push`, which also keeps your GitHub streak going.

You can sync the same export more than once. Entries already in the ledger are skipped.

## Updating from your phone (no laptop needed)

The raw chat goes to a **private** repo (`stockbook-inbox`). A GitHub Action there updates this public repo, so only the stock record is ever public.

1. WhatsApp → group → ⋮ → More → Export chat → **Without media** → save the file.
2. In a browser, open `github.com/kmiringu/stockbook-inbox` → **Add file → Upload files** → pick the `.txt` → **Commit changes**.
3. About a minute later the live page updates. The **Actions** tab of the inbox repo shows the run, a status summary ready to paste and any messages that need fixing.

Uploading the same chat again is safe because entries already recorded are skipped. To let a deputy do this while you're away, add them as a collaborator on the inbox repo.

Setting this up for another business: create a private repo, copy `templates/inbox-sync.yml` to `.github/workflows/sync.yml` and set the variable `STOCKBOOK_REPO`. Then generate an SSH key, add the public half as a **write** deploy key on the stockbook repo, and save the private half as the secret `STOCKBOOK_DEPLOY_KEY` in the inbox repo.

## Files

- `business.toml`: business name, items, units, prices and reorder levels. Edit this file to use the system for another business.
- `ledger.csv`: every movement, added to and never edited. Fix mistakes with `#return` or `#count`.
- `needs-attention.csv`: messages that could not be read.
- `STOCK.md` and `docs/index.html`: generated reports. The HTML file is the GitHub Pages dashboard for the group.

The script needs Python 3.11+ and nothing else.

## Using it for another business

Copy the folder, delete `ledger.csv`, edit `business.toml` and log the opening stock with `#in`.

## Roadmap (one small PR each)

- [ ] Rod sizes as separate items (2.5 mm / 3.2 mm / 4.0 mm)
- [ ] Price per job and money owed by each person
- [ ] GitHub Action that rebuilds the page on every push
- [ ] Weekly summary of how fast stock is being used
- [x] Update from a phone (private inbox repo + Action)
- [ ] WhatsApp Cloud API webhook so no export is needed
