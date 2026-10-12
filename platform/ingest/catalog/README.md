# Medicine catalogue

`medicines.csv`: the worldwide medicine list behind "Add a product" on the manufacturer side, 4,260 names with WHO ATC codes.
Source: Wikidata (items with an ATC code or an INN), public domain (CC0). Public data only; nothing private belongs here.
`migrate.py` loads it once into `medicine_catalog` when that table is empty.

`atc_names.csv` and `ru_names.csv`: English names for WHO ATC codes, and Russian names of the same medicines, from
Wikidata (CC0). The country loader uses them to put the Kazakhstan and Uzbekistan registries (in Russian) into English.

`lists/eml_<CC>.csv`: the essential medicines lists of Kazakhstan (national formulary, ATC codes), Kyrgyzstan (Latin
names and ATC codes), Uzbekistan (names, read from the scanned order) and Kenya (2023 list, names and levels of use).
Names and codes only, taken from the public lists; the documents themselves are not republished.
