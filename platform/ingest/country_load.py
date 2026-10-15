"""Registries and essential lists for the markets beyond Tanzania: Kazakhstan, Kyrgyzstan, Uzbekistan and Kenya.

Each registry export has its own columns and language (Russian in Kazakhstan and Uzbekistan). An adapter turns it
into one shape; names are put into English (ATC code, then names learned from the export itself, then transliteration
and a close match to molecules we already track), and the shared loader steps do the rest: registrations with
history, country molecule facts, scores, company stats and alerts.

Tanzania keeps its own pipeline (pipeline/build.py). Companies here are kept per country ('KZ|key'), so loading one
market never merges or renames another market's companies. Molecule names and classes of existing molecules are
never overwritten.
"""
import csv
import json
import datetime as dt
import hashlib
import os
import re
import sys
from collections import Counter, defaultdict, namedtuple

import pandas as pd
from rapidfuzz import fuzz, process

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "pipeline"))

from norm import company_key, display_name, form_of, molecule_key, same_stem, spelling_variants  # noqa: E402
import loader  # noqa: E402
import xlsx_rows  # noqa: E402

COUNTRIES = {"KZ": "KAZAKHSTAN", "KG": "KYRGYZSTAN", "UZ": "UZBEKISTAN", "KE": "KENYA"}
CATALOG = os.path.join(HERE, "catalog", "medicines.csv")
ATC_NAMES = os.path.join(HERE, "catalog", "atc_names.csv")
RU_NAMES = os.path.join(HERE, "catalog", "ru_names.csv")
LISTS = os.path.join(HERE, "catalog", "lists")
TODAY = dt.date.today()

# ------------------------------------------------------------------ language helpers
CYR = re.compile(r"[Ѐ-ӿ]")
TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюяіїєўғқңөұүһә",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f",
                     "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya", "i", "i", "e", "u", "g", "k", "n", "o", "u", "u", "h", "a"]))


def translit(s):
    return "".join(TRANSLIT.get(ch, TRANSLIT.get(ch.lower(), ch).upper() if ch.isupper() else ch) for ch in s or "")


RU_COUNTRY = {
    "индия": "INDIA", "россия": "RUSSIA", "российская федерация": "RUSSIA", "германия": "GERMANY", "китай": "CHINA",
    "казахстан": "KAZAKHSTAN", "республика казахстан": "KAZAKHSTAN", "узбекистан": "UZBEKISTAN", "кыргызстан": "KYRGYZSTAN",
    "киргизия": "KYRGYZSTAN", "беларусь": "BELARUS", "республика беларусь": "BELARUS", "белоруссия": "BELARUS", "украина": "UKRAINE",
    "турция": "TURKEY", "франция": "FRANCE", "италия": "ITALY", "испания": "SPAIN", "швейцария": "SWITZERLAND",
    "австрия": "AUSTRIA", "венгрия": "HUNGARY", "польша": "POLAND", "словения": "SLOVENIA", "хорватия": "CROATIA",
    "сербия": "SERBIA", "болгария": "BULGARIA", "румыния": "ROMANIA", "чехия": "CZECH REPUBLIC", "чешская республика": "CZECH REPUBLIC",
    "словакия": "SLOVAKIA", "словацкая республика": "SLOVAKIA", "латвия": "LATVIA", "литва": "LITHUANIA", "эстония": "ESTONIA",
    "греция": "GREECE", "кипр": "CYPRUS", "израиль": "ISRAEL", "иран": "IRAN", "пакистан": "PAKISTAN", "бангладеш": "BANGLADESH",
    "египет": "EGYPT", "иордания": "JORDAN", "армения": "ARMENIA", "грузия": "GEORGIA", "азербайджан": "AZERBAIJAN",
    "великобритания": "UNITED KINGDOM", "соединенное королевство": "UNITED KINGDOM", "ирландия": "IRELAND",
    "нидерланды": "NETHERLANDS", "бельгия": "BELGIUM", "дания": "DENMARK", "швеция": "SWEDEN", "финляндия": "FINLAND",
    "норвегия": "NORWAY", "португалия": "PORTUGAL", "сша": "USA", "соединенные штаты америки": "USA", "канада": "CANADA",
    "япония": "JAPAN", "корея": "SOUTH KOREA", "республика корея": "SOUTH KOREA", "южная корея": "SOUTH KOREA", "вьетнам": "VIETNAM",
    "индонезия": "INDONESIA", "малайзия": "MALAYSIA", "сингапур": "SINGAPORE", "таиланд": "THAILAND", "австралия": "AUSTRALIA",
    "аргентина": "ARGENTINA", "бразилия": "BRAZIL", "мексика": "MEXICO", "куба": "CUBA", "оаэ": "UAE",
    "объединенные арабские эмираты": "UAE", "саудовская аравия": "SAUDI ARABIA", "сирия": "SYRIA", "ливан": "LEBANON",
    "северная македония": "NORTH MACEDONIA", "македония": "NORTH MACEDONIA", "босния и герцеговина": "BOSNIA AND HERZEGOVINA",
    "молдова": "MOLDOVA", "республика молдова": "MOLDOVA", "таджикистан": "TAJIKISTAN", "туркменистан": "TURKMENISTAN",
    "монголия": "MONGOLIA", "тайвань": "TAIWAN", "исландия": "ICELAND", "люксембург": "LUXEMBOURG", "мальта": "MALTA",
    "южная африка": "SOUTH AFRICA", "юар": "SOUTH AFRICA", "кения": "KENYA", "непал": "NEPAL", "шри-ланка": "SRI LANKA",
    "черногория": "MONTENEGRO", "албания": "ALBANIA", "новая зеландия": "NEW ZEALAND", "чили": "CHILE", "колумбия": "COLOMBIA",
    "марокко": "MOROCCO", "тунис": "TUNISIA", "алжир": "ALGERIA", "ирак": "IRAQ", "филиппины": "PHILIPPINES", "лихтенштейн": "LIECHTENSTEIN",
}
COUNTRY_ALIASES = {"UNITED STATES": "USA", "UNITED STATES OF AMERICA": "USA", "UK": "UNITED KINGDOM", "RUSSIAN FEDERATION": "RUSSIA",
                   "KOREA": "SOUTH KOREA", "REPUBLIC OF KOREA": "SOUTH KOREA", "PEOPLES REPUBLIC OF CHINA": "CHINA", "P.R. CHINA": "CHINA"}


def country_en(s):
    s = re.sub(r"^\s*\d+\.\s*", "", str(s or "")).strip(" .,()").lower()
    if not s:
        return None
    if s in RU_COUNTRY:
        return RU_COUNTRY[s]
    if CYR.search(s):
        return translit(s).upper()
    up = s.upper()
    return COUNTRY_ALIASES.get(up, up)


def split_country(text):
    """'SJC Recipharm Fontaine Франция' -> ('SJC Recipharm Fontaine', 'FRANCE'); 'Name (France)' -> ('Name', 'FRANCE')."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    m = re.match(r"^(.*?)\s*\(([^()]+)\)\s*$", text)
    if m and not re.search(r"\d", m.group(2)):
        return m.group(1).strip(), country_en(m.group(2))
    low = text.lower()
    for name in sorted(RU_COUNTRY, key=len, reverse=True):
        if low.endswith(" " + name) or low == name:
            return text[: len(text) - len(name)].strip(" ,"), RU_COUNTRY[name]
    return text, None


def strip_address(text):
    """'РУП Белмедпрепараты Республика Беларусь 231761, Гродненская обл., ...' -> 'РУП Белмедпрепараты'."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    low = text.lower()
    cut = len(text)
    for name in list(RU_COUNTRY) + ["республика"]:
        i = low.find(" " + name)
        if i > 2:
            cut = min(cut, i)
    m = re.search(r"\s\d{4,}|,\s*(ул\.|г\.|обл\.|район)", text)
    if m and m.start() > 2:
        cut = min(cut, m.start())
    return text[:cut].strip(" ,.")


RU_FORMS = [("инъекц|инфуз|внутривен|внутримыш|ампул|флакон|лиофилизат", "injection"), ("таблет|драже|пастилк", "tablet"),
            ("капсул", "capsule"), ("сироп|суспенз|для приема внутрь|капли для приема|эмульс|эликсир", "syrup"),
            ("глазн", "eye drops"), ("назальн|в нос|ушн", "nasal spray"), ("ингаля|аэрозол|небулай", "inhaler"),
            ("суппозит|вагинальн|ректальн|свеч", "suppository"),
            ("крем|мазь|гель|лосьон|наружн|пластыр|шампун|линимент", "cream"), ("порошок|гранул|саше", "powder"), ("раствор", "solution")]


def form_en(s):
    s = str(s or "")
    if not CYR.search(s):
        return s
    low = s.lower()
    for rx, en in RU_FORMS:
        if re.search(rx, low):
            return en
    return translit(s)


STRENGTH = re.compile(r"\d[\d.,]*\s*(мг|мкг|г|мл|ме|ед|%|mg|mcg|g|ml|iu)\b(\s*/\s*[\d.,]*\s*(мл|г|ml|g|доза|dose))?", re.I)


def year_of(v):
    v = str(v or "").strip()
    if not v:
        return None
    if re.fullmatch(r"\d{5}(\.0+)?", v):                       # Excel serial date
        return (dt.date(1899, 12, 30) + dt.timedelta(days=float(v))).year
    m = re.search(r"(19|20)\d{2}", v)
    y = int(m.group(0)) if m else None
    return y if y and 1960 <= y <= TODAY.year + 1 else None


def date_of(v):
    v = str(v or "").strip()
    if not v:
        return None
    if re.fullmatch(r"\d{5}(\.0+)?", v):
        return dt.date(1899, 12, 30) + dt.timedelta(days=float(v))
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})", v) or None
    if m:
        try:
            return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    m = re.search(r"((?:19|20)\d{2})-(\d{2})-(\d{2})", v)
    return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


# ------------------------------------------------------------------ adapters: one shape for every registry
FIELDS = ["certificate_no", "brand", "generic", "atc", "dosage_form", "strength", "manufacturer", "manufacturing_country",
          "holder", "ltr", "reg_year", "status", "active"]


def _table(path, header_words):
    """Every sheet's rows as dicts, from the header row that contains the given words."""
    if str(path).lower().endswith((".xls", ".html", ".htm")):
        frames = pd.read_html(path, flavor="lxml") if not str(path).lower().endswith(".xls") else [pd.read_excel(path, header=None, dtype=str)]
        # an HTML table's <th> header becomes pandas' column names: keep it as the first row
        sheets = {str(i): [[str(c).strip() for c in f.columns]] + [[("" if pd.isna(c) else str(c)).strip() for c in r] for r in f.values.tolist()]
                  for i, f in enumerate(frames)}
    else:
        sheets = xlsx_rows.rows(path)
    out = []
    for rows in sheets.values():
        at = next((i for i, r in enumerate(rows[:20]) if all(any(w.lower() in c.lower() for c in r) for w in header_words)), None)
        if at is None:
            continue
        head = rows[at]
        for r in rows[at + 1:]:
            if any(r):
                out.append({h: (r[i] if i < len(r) else "") for i, h in enumerate(head)})
    if not out:
        raise ValueError(f"This does not look like the expected registry export (no header with {', '.join(header_words)}).")
    return out


def read_kz(path):
    out = []
    for r in _table(path, ["Рег. номер", "МНН"]):
        man, ctry = r.get("Производитель", ""), r.get("Страна", "")
        first = lambda s: re.split(r"\s*,?\s*\d+\.\s+", " " + s)[1] if re.match(r"^\s*1\.", s) else s
        exp = date_of(r.get("Дата истечение"))
        form = r.get("Лек. форма", "")
        out.append(dict(certificate_no=r.get("Рег. номер"), brand=r.get("Торговое название"), generic=r.get("МНН"),
                        atc=r.get("Код АТХ"), atc_name=r.get("Наименование кода АТХ"), dosage_form=form, strength=(STRENGTH.search(form) or [None])[0],
                        manufacturer=first(man).split(",")[0].strip(), manufacturing_country=country_en(first(ctry)),
                        holder=r.get("ДРУ") or None, ltr=None, reg_year=year_of(r.get("Дата регистрации")),
                        status="Expired" if exp and exp < TODAY else "Registered", active=not (exp and exp < TODAY)))
    return out


def read_kg(path):
    out = []
    for r in _table(path, ["Brand Name", "INN", "Registration Number"]):
        man, ctry = split_country(r.get("Manufacturer Company"))
        status = r.get("Status") or "Active"
        out.append(dict(certificate_no=r.get("Registration Number"), brand=r.get("Brand Name"), generic=r.get("INN"), atc=None,
                        dosage_form=r.get("New Form Code"), strength=None, manufacturer=man, manufacturing_country=ctry,
                        holder=None, ltr=None, reg_year=year_of((re.findall(r"(?:19|20)\d{2}", r.get("Registration Number") or "") or [""])[-1]),
                        status=status, active=status.lower().startswith("activ")))
    return out


def read_uz(path):
    """Two exports: the register bulletin ('Регистрационные удостоверения': holder, manufacturer, country, INN, ATC, date)
    and the older four-sheet export (new and re-registrations, local and foreign)."""
    by_cert = {}
    try:
        rows = _table(path, ["Номер регистрационного удостоверения", "Держатель", "МНН"])
        bulletin = any("АТХ-коды" in k for k in rows[0])
    except ValueError:
        rows, bulletin = _table(path, ["Торговая марка", "МНН"]), False
    for r in rows:
        if bulletin:
            man, mctry = strip_address(r.get("Производитель")), None
            mctry = country_en(r.get("Страна производителя")) or mctry
            holder, hctry = split_country(r.get("Держатель"))
            holder = strip_address(holder)
            cert = r.get("Номер регистрационного удостоверения")
            when = date_of(next((v for k, v in r.items() if k.startswith("Дата выдачи")), ""))
            atc = (r.get("АТХ-коды") or "").split(",")[0].split(";")[0].strip()
            form = next((v for k, v in r.items() if "box_groups" in k), "")
            row = dict(certificate_no=cert, brand=r.get("Торговое название"), generic=r.get("МНН"), atc=atc,
                       dosage_form=form, strength=r.get(next((k for k in r if k.startswith("Доза")), ""), None) or None,
                       manufacturer=man, manufacturing_country=mctry, holder=holder, ltr=holder if hctry == "UZBEKISTAN" else None,
                       reg_year=when.year if when else None, status="Registered", active=True, _when=when or dt.date(1900, 1, 1))
        else:
            man, mctry = split_country(r.get("Производитель"))
            holder, hctry = split_country(r.get("Держатель"))
            cert = r.get("Номер регистрационного удостоверения") or r.get("Номер регистрации")
            when = date_of(r.get("Дата регистрационного удостоверения"))
            row = dict(certificate_no=cert, brand=r.get("Торговая марка"), generic=r.get("МНН"), atc=r.get("АТХ-код"),
                       dosage_form=r.get("Формы выпуска"), strength=None, manufacturer=man, manufacturing_country=mctry,
                       holder=holder, ltr=holder if hctry == "UZBEKISTAN" else None, reg_year=when.year if when else None,
                       status=r.get("Состояние") or "Registered", active=True, _when=when or dt.date(1900, 1, 1))
        key = (cert, row["brand"], row["dosage_form"])
        if key not in by_cert or row["_when"] >= by_cert[key]["_when"]:   # a re-registration replaces the earlier row
            by_cert[key] = row
    return [{k: v for k, v in r.items() if k != "_when"} for r in by_cert.values()]


def read_ke(path):
    out = []
    for r in _table(path, ["Product Registration No", "Inn Of Api"]):
        reg = next((v for k, v in r.items() if "date of registration" in k.lower()), "")
        exp = date_of(r.get("Date of Expiry"))
        out.append(dict(certificate_no=r.get("Product Registration No"), brand=r.get("Product Trade Name"), generic=r.get("Inn Of Api"),
                        atc=None, dosage_form=r.get("Dosage Form Name"), strength=None, manufacturer=r.get("Mah Company Name"),
                        manufacturing_country=country_en(r.get("Country of Origin")), holder=r.get("Mah Company Name"),
                        ltr=r.get("Local Technical Representative") or None, reg_year=year_of(reg),
                        status="Expired" if exp and exp < TODAY else "Registered", active=not (exp and exp < TODAY)))
    return out


ADAPTERS = {"KZ": read_kz, "KG": read_kg, "UZ": read_uz, "KE": read_ke}


# ------------------------------------------------------------------ names in English, and the molecule each row is
EN_FIXES = {"vitamin c": "ascorbic acid", "vitamin b12": "cyanocobalamin", "vitamin b1": "thiamine", "vitamin b6": "pyridoxine",
            "vitamin d3": "colecalciferol", "vitamin a": "retinol", "vitamin e": "tocopherol",
            # US names to the international ones the rest of the data uses
            "glyburide": "glibenclamide", "acetaminophen": "paracetamol", "albuterol": "salbutamol", "meperidine": "pethidine",
            "cyclosporine": "ciclosporin", "rifampin": "rifampicin", "isoproterenol": "isoprenaline", "furosemide": "furosemide"}


def _clean_en(s):
    s = EN_FIXES.get(str(s or "").strip().lower(), s)
    s = re.sub(r"^\((?:[RS]|RS|SR|[+-]|±|\d+[RS](?:,\d+[RS])*)\)-|^(?:rac|dl|DL|d,l)-", "", str(s or "").strip())
    return re.sub(r"\(\d?[+-]\)\s*ion\b|\s+ion$", "", s).strip()


def load_catalog():
    """ATC code -> English names: Wikidata's ATC names first, then the medicine catalogue."""
    by_atc = defaultdict(list)
    if os.path.exists(ATC_NAMES):
        for r in csv.DictReader(open(ATC_NAMES, encoding="utf-8")):
            by_atc[r["atc"].strip().upper()].append(_clean_en(r["en"]))
    for r in csv.DictReader(open(CATALOG, encoding="utf-8")):
        a = (r.get("atc") or "").strip().upper()
        if a and a not in by_atc:
            by_atc[a].append(_clean_en(r["name"]))
    return by_atc


def load_ru():
    out = {}
    if os.path.exists(RU_NAMES):
        for r in csv.DictReader(open(RU_NAMES, encoding="utf-8")):
            out[r["ru"].strip().lower()] = _clean_en(r["en"])
    return out


def _norm_local(s):
    return re.sub(r"\s+", " ", re.sub(r"[®™*]", "", str(s or "").lower())).strip(" .,")


def _parts(s):
    return [p.strip() for p in re.split(r"\s*\+\s*|\s*,\s*|\s+и\s+", s) if p.strip()]


GROUP_WORDS = re.compile(r"прочие|другие|разные|комбинац|препарат|средств|в комбинации|производн|экстракт|сбор|трав[аыы]")


NO_DATA = {"нет данных", "нет сведений", "нет", "-", "—", "не указано", "отсутствует", "n/a", "na", "none", "комбинированный препарат"}
# salts, hydrates and common words in Russian generic names (None: dropped)
RU_WORDS = {
    "гидрохлорид": "hydrochloride", "гидрохлорида": "hydrochloride", "гидробромид": "hydrobromide", "гидробромида": "hydrobromide",
    "натрия": "sodium", "натрий": "sodium", "натриевая": "sodium", "калия": "potassium", "калий": "potassium", "кальция": "calcium",
    "кальций": "calcium", "магния": "magnesium", "магний": "magnesium", "цинка": "zinc", "цинк": "zinc", "железа": "iron",
    "железо": "iron", "меди": "copper", "лития": "lithium", "алюминия": "aluminium", "аммония": "ammonium", "серебра": "silver",
    "сульфат": "sulfate", "сульфата": "sulfate", "малеат": "maleate", "малеата": "maleate", "ацетат": "acetate", "ацетата": "acetate",
    "фосфат": "phosphate", "фосфата": "phosphate", "тартрат": "tartrate", "тартрата": "tartrate", "бромид": "bromide", "бромида": "bromide",
    "хлорид": "chloride", "хлорида": "chloride", "цитрат": "citrate", "цитрата": "citrate", "безилат": "besilate", "безилата": "besilate",
    "мезилат": "mesilate", "мезилата": "mesilate", "фумарат": "fumarate", "фумарата": "fumarate", "сукцинат": "succinate",
    "сукцината": "succinate", "нитрат": "nitrate", "нитрата": "nitrate", "оксид": "oxide", "оксида": "oxide", "карбонат": "carbonate",
    "карбоната": "carbonate", "лактат": "lactate", "лактата": "lactate", "глюконат": "gluconate", "глюконата": "gluconate",
    "дипропионат": "dipropionate", "дипропионата": "dipropionate", "пропионат": "propionate", "валерат": "valerate",
    "бутират": "butyrate", "гемифумарат": "hemifumarate", "тозилат": "tosilate", "мелат": "malate", "бензоат": "benzoate",
    "стеарат": "stearate", "йодид": "iodide", "фторид": "fluoride", "гидроксид": "hydroxide", "трисиликат": "trisilicate",
    "дигидрат": None, "моногидрат": None, "тригидрат": None, "гидрат": None, "гептагидрат": None, "гексагидрат": None,
    "безводный": None, "безводная": None, "безводного": None, "микронизированный": None, "стерильный": None,
    "кислота": "acid", "кислоты": "acid", "кислоте": "acid",
}
GENITIVE = [("ой", "ая"), ("ого", "ый"), ("ия", "ий"), ("ы", "а"), ("а", ""), ("я", "ь"), ("и", "ь"), ("и", "")]


def _candidates(word):
    yield word
    for end, rep in GENITIVE:
        if word.endswith(end) and len(word) > len(end) + 3:
            yield word[: -len(end)] + rep


def pharma_translit(s):
    """Transliteration that lands closer to English drug names: 'azitromitsin' -> 'azitromicin'."""
    t = translit(s).lower()
    t = re.sub(r"ts(?=[iey])", "c", t)
    t = re.sub(r"ks", "x", t)
    t = re.sub(r"iy\b", "ium", t)
    t = re.sub(r"\bk(?=[laour])", "c", t)
    return t


class Namer:
    """English name for a generic name in any of the registries' languages."""

    def __init__(self, rows, by_atc):
        self.by_atc = by_atc
        self.ru = load_ru()
        votes = defaultdict(Counter)
        for r in rows:
            local, atc = _norm_local(r["generic"]), (r.get("atc") or "").strip().upper()
            names = by_atc.get(atc, [])
            if local and CYR.search(local) and names and len(_parts(local)) == 1 and local not in NO_DATA:
                votes[self._base(local)[0]][names[0]] += 1
        self.votes = {k: v.most_common(1)[0][0] for k, v in votes.items() if k}
        self.translit_only = set()

    def _base(self, phrase):
        """(the medicine words, the salt words in English) of one Russian ingredient."""
        words = re.sub(r"\(.*?\)", " ", phrase).split()
        base, salts = [], []
        for w in words:
            if w in RU_WORDS:
                if RU_WORDS[w] and RU_WORDS[w] != "acid":
                    salts.append(RU_WORDS[w])
                elif RU_WORDS[w] == "acid":
                    base.append(w)
            else:
                base.append(w)
        return " ".join(base), salts

    def _lookup(self, phrase):
        if phrase in self.ru:
            return self.ru[phrase]
        words = phrase.split()
        for combo in self._combos(words):
            if combo in self.ru:
                return self.ru[combo]
            if combo in self.votes:
                return self.votes[combo]
        return None

    @staticmethod
    def _combos(words):
        """Nominative variants of a phrase (each word through its genitive endings), most likely first."""
        variants = [[]]
        for w in words[:3]:
            variants = [v + [c] for v in variants for c in list(dict.fromkeys(_candidates(w)))[:4]]
        return [" ".join(v) for v in variants[:64]]

    def ingredient(self, part):
        part = _norm_local(part)
        hit = self._lookup(part)
        if hit:
            return hit
        base, salts = self._base(part)
        en = self._lookup(base)
        acid = re.fullmatch(r"(\S+?)(овая|евая|овой|евой|ная|ной) кислот[аы]", base)
        if not en and acid:                                 # клавулановая кислота -> clavulanic acid
            en = self._lookup(acid.group(1)) or (pharma_translit(acid.group(1)) + "ic acid")
        if not en and base:
            en = " ".join(self._lookup(w) or pharma_translit(w) for w in base.split())
            self.translit_only.add(en.lower())
        return " ".join([en or "", *salts]).strip()

    def english(self, generic, atc, atc_name=None):
        local = _norm_local(generic)
        atc = (atc or "").strip().upper()
        names = self.by_atc.get(atc, [])
        if not local or local in NO_DATA:
            if names:
                return names[0]
            local = _norm_local(atc_name)
            # a group name ("other preparations", "combinations") says nothing about the medicine
            if not local or local in NO_DATA or GROUP_WORDS.search(local):
                return None
        if not CYR.search(local):
            return generic if local == _norm_local(generic) else local
        if GROUP_WORDS.search(local) and not names:   # a class or a herbal mixture, not one medicine
            return None
        parts = _parts(local)
        if len(parts) == 1 and names:
            return names[0]
        return " + ".join(self.ingredient(p) for p in parts)


class Matcher:
    """Molecule keys resolved to the molecules we already track: alias, exact key, then a close spelling."""

    def __init__(self, cur):
        self.alias = dict(cur.execute("select alias, molecule_id from molecule_aliases").fetchall())
        self.by_key = dict(cur.execute("select canonical_key, id from molecules").fetchall())
        self.known = list({*self.alias, *self.by_key})
        self.memo = {}

    def resolve(self, key, loose=False):
        """The known key for this one, or the key itself (a new molecule). Transliterated names match more loosely."""
        if not key:
            return key
        if key in self.memo:
            return self.memo[key]
        out = key
        if key not in self.alias and key not in self.by_key and len(key) >= 6 and self.known:
            best = process.extractOne(key, self.known, scorer=fuzz.token_sort_ratio, score_cutoff=84 if loose else 90)
            if best and len(best[0]) >= 6 and len(best[0].split()) == len(key.split()) and same_stem(key, best[0]):
                out = best[0]
        self.memo[key] = out
        return out

    def molecule_id(self, cur, key, inn, category):
        mid = self.alias.get(key) or self.by_key.get(key)
        if mid is None:
            mid = cur.execute("insert into molecules (canonical_key, inn, category) values (%s, %s, %s) returning id",
                              (key, inn, category)).fetchone()[0]
            self.by_key[key] = mid
            self.known.append(key)
        elif category:
            cur.execute("update molecules set category = %s where id = %s and category is null", (category, mid))
        return mid


ATC_CLASS = [("A10", "Medicines for Diabetes and Related Disorders"), ("A11", "Vitamins and Minerals"), ("A12", "Vitamins and Minerals"),
             ("A09", "Digestive and Pancreatic Enzymes"), ("A", "Gastro-intestinal Medicines"),
             ("B05", "Solutions Correcting Water, Electrolyte and Acid-Base Disturbances"), ("B", "Medicines Affecting the Blood"),
             ("C", "Cardiovascular Medicines"), ("D", "Dermatological Medicines"), ("G02", "Oxytocics and Anti-oxytocics"),
             ("G01", "Anti-infective Medicines"), ("G", "Hormones and Antihormones"), ("H", "Hormones and Antihormones"),
             ("J07", "Immunological Agents"), ("J06", "Immunological Agents"), ("J", "Anti-infective Medicines"),
             ("L", "Antineoplastics, Immunosuppressives and Immunomodulators"), ("M03", "Muscle Relaxants and Cholinesterase Inhibitors"),
             ("M05", "Bisphosphonates"), ("M", "Medicines for Pain and Palliative Care"),
             ("N01", "Anaesthetics, Preoperative Medicines and Medical Gases"), ("N02C", "Antimigraine Medicines"),
             ("N02", "Medicines for Pain and Palliative Care"), ("N03", "Anticonvulsants and Antiepileptics"),
             ("N04", "Anti-Parkinsonism and Anti-prolactinoma Medicines"), ("N", "Psychotherapeutic and Related Medicines"),
             ("P", "Anti-infective Medicines"), ("R06", "Anti-allergies and Medicines Used in Anaphylaxis"),
             ("R01", "Ear, Nose and Throat Medicines"), ("R02", "Ear, Nose and Throat Medicines"), ("R", "Medicines Acting on the Respiratory Tract"),
             ("S01", "Ophthalmological Preparations"), ("S", "Ear, Nose and Throat Medicines"),
             ("V03AB", "Antidotes and Other Substances Used in Poisonings"), ("V", None)]


def atc_class(atc):
    atc = (atc or "").strip().upper()
    return next((c for p, c in ATC_CLASS if atc.startswith(p)), None) if atc else None


HYDRATES = re.compile(r"\s+(dihydrate|monohydrate|trihydrate|hemihydrate|sesquihydrate|heptahydrate|hexahydrate|pentahydrate|"
                      r"hydrate|anhydrous|micronized|sterile)\b", re.I)


def nice(name):
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    return name[:1].upper() + name[1:].lower() if name and (name.isupper() or name.islower()) else name


def company(name, country):
    """(cluster key, display name) for a company in one market; None when there is no usable name."""
    name = re.sub(r"\s+", " ", str(name or "")).strip(" ,.")
    if not name:
        return None
    latin = translit(name) if CYR.search(name) else name
    key = company_key(latin)
    if not key:
        return None
    return f"{country}|{key}", (latin if CYR.search(name) else name)


# ------------------------------------------------------------------ essential lists
def read_list(country):
    """The country's essential list shipped with the worker (catalog/lists/eml_<CC>.csv): name, atc, level."""
    path = os.path.join(LISTS, f"eml_{country}.csv")
    if not os.path.exists(path):
        return []
    return list(csv.DictReader(open(path, encoding="utf-8")))


ENGLISH_UM = {"sodium", "calcium", "potassium", "magnesium", "barium", "lithium", "aluminium", "ammonium", "chromium", "selenium",
              "titanium", "zirconium", "radium", "strontium", "germanium", "gallium", "indium", "technetium", "iridium", "palladium",
              "platinum", "molybdenum", "cerium", "lanthanum", "gadolinium", "thallium", "bismuth", "serum", "opium", "medium", "premium"}


def latin_inn(name):
    """Latin pharmacopoeia names ('Amoxicillinum', 'Natrii chloridum') -> English-like ('amoxicillin', 'natri chlorid')."""
    words = []
    for w in str(name or "").split():
        lw = w.lower()
        if lw not in ENGLISH_UM and len(lw) > 5:
            w = re.sub(r"um$", "", w, flags=re.I)
        words.append(w)
    return " ".join(words)


UZ_WORDS = {"natriy": "sodium", "natriya": "sodium", "kaliy": "potassium", "kalsiy": "calcium", "kaltsiy": "calcium", "magniy": "magnesium",
            "temir": "iron", "rux": "zinc", "xloridi": "chloride", "xlorid": "chloride", "gidroxlorid": "hydrochloride",
            "gidroxloridi": "hydrochloride", "sulfati": "sulfate", "sulfat": "sulfate", "fosfati": "phosphate", "atsetat": "acetate",
            "vaksinasi": "vaccine", "vaksina": "vaccine", "kislotasi": "acid", "dinatriy": "disodium", "suksinat": "succinate",
            "peroksid": "peroxide", "vodorod": "hydrogen", "moyi": "oil"}


def uzbek_latin(name):
    """Uzbek Latin spellings to English drug spelling: 'Siprofloksatsin' -> 'ciprofloxacin', 'Natriy xloridi' -> 'sodium chloride'."""
    out = []
    for w in str(name or "").lower().split():
        if w in UZ_WORDS:
            out.append(UZ_WORDS[w])
            continue
        w = w.replace("ks", "x").replace("ts", "c").replace("gidro", "hydro")
        w = re.sub(r"x(?=[lor])", "ch", w)
        w = re.sub(r"^s(?=[eiy])", "c", w)
        w = re.sub(r"(?<=\w)k(?=[oalr])", "c", w)
        out.append(w)
    return " ".join(out)


LIST_NAMES = {"KG": latin_inn, "UZ": uzbek_latin}
# lists whose unmatched entries become new molecules (openings): clean, typed lists only, not the scanned one
NEW_FROM_LIST = {"KG", "KE", "KZ"}


# ------------------------------------------------------------------ the load
def apply(conn, path, upload_id, country, initial=False, who_keys=()):
    if country not in ADAPTERS:
        raise ValueError(f"No reader for {country} registries yet.")
    rows = json.load(open(path, encoding="utf-8")) if str(path).endswith(".json") else ADAPTERS[country](path)   # .json: collected
    raw = [r for r in rows if r.get("certificate_no") or r.get("brand")]
    if len(raw) < 50:
        raise ValueError(f"Only {len(raw)} products in this file. This does not look like the full {COUNTRIES[country].title()} register.")
    cur = conn.cursor()
    by_atc = load_catalog()
    namer, match = Namer(raw, by_atc), Matcher(cur)
    local_country = COUNTRIES[country]

    # 1. rows in one shape, with an English name and a molecule key
    for r in raw:
        r["en"] = namer.english(r["generic"], r.get("atc"), r.get("atc_name")) or ""
        r["raw_key"] = molecule_key(r["en"])
    # spellings of one medicine within the file ('metronidazol' / 'metronidazole') become one, the commonest or known one
    counts = Counter(r["raw_key"] for r in raw if r["raw_key"])
    variants = spelling_variants(counts, known=set(match.known), min_len=6)
    resolved = {}
    for k, _ in counts.most_common():                 # the commonest spellings first, so variants find them
        k2 = variants.get(k, k)
        loose = any(t and t in k2 for t in namer.translit_only)
        resolved[k] = match.resolve(k2, loose=loose)
    regs = []
    for r in raw:
        en = r["en"]
        key = resolved.get(r["raw_key"], r["raw_key"])
        fp = hashlib.sha1("|".join(str(r.get(k) or "") for k in ("certificate_no", "brand", "generic", "dosage_form")).encode()).hexdigest()
        man = company(r["manufacturer"], country)
        reg = company(r["holder"], country) or man
        ltr = company(r["ltr"], country)
        regs.append(dict(r, key=key, fingerprint=fp, man=man, reg=reg, ltrc=ltr,
                         form=form_of(form_en(r["dosage_form"])), cls=atc_class(r.get("atc"))))
    seen = set()
    regs = [r for r in regs if not (r["fingerprint"] in seen or seen.add(r["fingerprint"]))]

    # 2. molecules (never renaming one we already have)
    names = defaultdict(Counter)
    classes = defaultdict(Counter)
    for r in regs:
        if r["key"]:
            names[r["key"]][HYDRATES.sub("", display_name(r["en"]) or nice(r["en"]))] += 1
            if r["cls"]:
                classes[r["key"]][r["cls"]] += 1
    key_to_id = {k: match.molecule_id(cur, k, c.most_common(1)[0][0], classes[k].most_common(1)[0][0] if classes[k] else None)
                 for k, c in names.items()}
    for k, mid in key_to_id.items():
        cur.execute("insert into molecule_aliases (alias, molecule_id, source) values (%s, %s, 'auto') on conflict (alias) do nothing", (k, mid))

    # 3. companies of this market
    comps = {}
    for r in regs:
        for role, c in (("man", r["man"]), ("reg", r["reg"]), ("ltr", r["ltrc"])):
            if c:
                e = comps.setdefault(c[0], {"name": c[1], "roles": set(), "country": None})
                e["roles"].add(role)
                if role == "man" and r["manufacturing_country"]:
                    e["country"] = r["manufacturing_country"]
    existing = dict(cur.execute("select cluster_key, id from companies where cluster_key like %s", (f"{country}|%",)).fetchall())
    cluster_to_id = {}
    for ck, e in comps.items():
        flags = ("ltr" in e["roles"], "reg" in e["roles"], "man" in e["roles"])
        if ck in existing:
            cid = existing[ck]
            cur.execute("""update companies set display_name = %s, country = coalesce(%s, country), is_ltr = %s, is_registrant = %s,
                           is_manufacturer = %s where id = %s""", (e["name"][:200], e["country"], *flags, cid))
        else:
            cid = cur.execute("""insert into companies (display_name, cluster_key, country, is_ltr, is_registrant, is_manufacturer)
                                 values (%s, %s, %s, %s, %s, %s) returning id""", (e["name"][:200], ck, e["country"], *flags)).fetchone()[0]
        cluster_to_id[ck] = cid

    # 4. registrations, with history (the shared loader step)
    frame = pd.DataFrame([dict(fingerprint=r["fingerprint"], certificate_no=r["certificate_no"], key=r["key"], brand=r["brand"],
                               generic_name=(display_name(r["en"]) or nice(r["en"])) if r["en"] else r["generic"], dosage_form=form_en(r["dosage_form"]) or None, form=r["form"],
                               strength=r["strength"], api_text=r["generic"], registrant_cluster=r["reg"][0] if r["reg"] else None,
                               ltr_cluster=r["ltrc"][0] if r["ltrc"] else None, manufacturer_cluster=r["man"][0] if r["man"] else None,
                               manufacturing_country=r["manufacturing_country"], status=r["status"], active=bool(r["active"]),
                               reg_year=r["reg_year"]) for r in regs])
    frame["reg_year"] = frame["reg_year"].astype("Int64")
    diff = loader.load_registrations(cur, {"regs": frame}, key_to_id, cluster_to_id, upload_id, country, record_history=not initial)

    # 5. per molecule: competition from active products, and the essential list
    stats = defaultdict(lambda: dict(regs=0, registrants=set(), ltrs=set(), mans=set(), local=0, forms=Counter()))
    for r in regs:
        if r["key"] and r["active"]:
            s = stats[r["key"]]
            s["regs"] += 1
            if r["reg"]:
                s["registrants"].add(r["reg"][0])
            if r["ltrc"]:
                s["ltrs"].add(r["ltrc"][0])
            if r["man"]:
                s["mans"].add(r["man"][0])
            s["local"] += r["manufacturing_country"] == local_country
            s["forms"][r["form"]] += 1
    who = set(who_keys)
    RegM = namedtuple("RegM", "key display in_who registrations registrants ltrs manufacturers local_made forms")
    regm = pd.DataFrame([RegM(k, "", k in who, s["regs"], len(s["registrants"]), len(s["ltrs"]), len(s["mans"]), s["local"],
                              ", ".join(f for f, _ in s["forms"].most_common(4) if f != "other") or None) for k, s in stats.items()])
    if regm.empty:
        regm = pd.DataFrame(columns=RegM._fields)
    match.memo.clear()       # list entries match against every molecule known now, this file's included
    ess = essential(cur, match, key_to_id, country, regs, who)
    loader.load_country_molecules(cur, {"regm": regm}, key_to_id, ess, country)
    moved = loader.recompute_gaps(cur, country, upload_id)
    loader.recompute_company_stats(cur, country)
    if not initial:
        loader.feed_for_new_registrations(cur, upload_id, country)
    active = sum(1 for r in regs if r["active"])
    summary = {"registry_rows": len(regs), "human_active": active, "molecules": len(stats),
               "named_in_english": sum(1 for r in regs if r["key"]), "essential_listed": len(ess),
               "essential_unregistered": sum(1 for mid in ess if not any(key_to_id.get(k) == mid for k in stats))}
    diff.update(gap_scores_moved=0 if initial else moved, companies=len(comps))
    return diff, summary


def essential(cur, match, key_to_id, country, regs, who):
    """The country's essential list against its molecules: {molecule_id: row for load_country_molecules}."""
    atc_key = defaultdict(Counter)
    for r in regs:
        if r["key"] and r.get("atc"):
            atc_key[r["atc"].strip().upper()][r["key"]] += 1
    by_atc = load_catalog()
    active_keys = Counter(r["key"] for r in regs if r["active"] and r["key"])
    token_sets = {k: set(k.split()) for k in active_keys}
    Ess = namedtuple("Ess", "molecule in_who level channel_flag note rankable in_combinations list_forms")
    out = {}
    for item in read_list(country):
        atc = (item.get("atc") or "").strip().upper()
        name = item.get("name") or ""
        key = None
        if atc and atc_key.get(atc):
            key = atc_key[atc].most_common(1)[0][0]
        if not key and atc and by_atc.get(atc):
            key = match.resolve(molecule_key(by_atc[atc][0]))
            name = name or by_atc[atc][0]
        english = LIST_NAMES.get(country, lambda x: x)(name) if name else ""
        if not key and english:
            key = match.resolve(molecule_key(english), loose=True)
        if not key:
            continue
        display = nice(english) if english else key
        known = key_to_id.get(key) or match.alias.get(key) or match.by_key.get(key)
        # a list entry nobody has registered becomes a new molecule (an opening), but only when its name is clean:
        # no recognition noise, no herbal or descriptive entries
        if not known and (country not in NEW_FROM_LIST or not (atc or re.fullmatch(r"[A-Za-z][A-Za-z\- ]{2,40}(\s*\+\s*[A-Za-z][A-Za-z\- ]{2,40}){0,3}", english or ""))):
            continue
        mid = known or match.molecule_id(cur, key, display, atc_class(atc))
        key_to_id.setdefault(key, mid)
        cur.execute("insert into molecule_aliases (alias, molecule_id, source) values (%s, %s, 'auto') on conflict (alias) do nothing", (key, mid))
        toks = set(key.split())
        combos = sum(n for k, n in active_keys.items() if k != key and toks <= token_sets[k])
        if mid not in out:
            out[mid] = Ess(display, key in who, None, None, None, True, combos, None)
    return out
