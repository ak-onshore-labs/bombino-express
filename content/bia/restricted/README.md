# Restricted items, for BIA

BIA answers "can I send this?" **only** from the files in this folder
(`server/supportRestricted.ts`, tool `can_i_ship`). When an item isn't listed,
or a country has no file, BIA says to check with our team and shows the contact
button. It never guesses.

## Files

- `ALL.md`: items restricted whatever the destination.
- `<CC>.md`: one per destination, named by its two-letter country code in
  capitals: `US.md`, `GB.md`, `AE.md`, `CA.md`, `AU.md`.

A file with no table rows counts as no file. Changes are picked up within a
minute, with no restart.

## Format

One table per file, with exactly these three columns. Anything outside the
table (headings, notes) is ignored.

```markdown
# United States

| Item | Also called | Rule |
|---|---|---|
| Lithium batteries | battery, batteries, power bank | Not accepted, loose or packed separately. Batteries inside a device are accepted. |
| Medicines | medicine, tablets, prescription drugs | Up to 3 months' personal supply, with a copy of the prescription. |
| Fresh fruit | fruit, mangoes | Not accepted. |
```

- **Item**: the name BIA says back.
- **Also called**: other words customers use, separated by commas. BIA matches
  whole words, so list the plural too when it differs (`battery, batteries`).
- **Rule**: said to the customer word for word. Write it as the answer: plain,
  complete, from the customer's side.

A `|` inside a cell breaks the table; write "or" instead.
