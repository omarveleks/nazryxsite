# Medicine catalogue

`medicines.csv`: the worldwide medicine list behind "Add a product" on the manufacturer side, 4,260 names with WHO ATC codes.
Source: Wikidata (items with an ATC code or an INN), public domain (CC0). Public data only; nothing private belongs here.
`migrate.py` loads it once into `medicine_catalog` when that table is empty.
