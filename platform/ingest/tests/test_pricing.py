import pricing


def test_pack_counts_units_and_strengths():
    assert pricing.units_in("АЗИТРАЛ Капсулы 500 мг блистеры №3(1x3)") == 3
    assert pricing.units_in("Нурофен 200 мг таблетки №10x2") == 20
    assert pricing.units_in("Amoxil 500mg capsules 2 x 10 caps") == 20
    assert pricing.units_in("Panadol 500mg tablets pack of 24") == 24
    assert pricing.units_in("Augmentin 625mg tabs 14s") == 14
    assert pricing.units_in("Paracetamol tablets") is None          # a counted pack that does not say how many
    assert pricing.units_in("Ceftriaxone 1g vial") == 1 and pricing.units_in("Jetix Сироп 125г флаконы") == 1
    assert pricing.unit_of("Раствор для инъекций 2 мл ампулы №10") == "ampoule or vial"
    assert pricing.unit_of("Amoxicillin 250mg/5ml suspension 100ml") == "pack"
    assert pricing.unit_of("БЕНЗИЛПЕНИЦИЛЛИНА натриевая соль 1г №1 фл.") == "ampoule or vial"
    assert pricing.strength_of("Rocephin 1Gm vial") == "1000 mg"
    assert pricing.strength_of("Цефтриаксон 1 г") == pricing.strength_of("Ceftriaxone 1000mg") == "1000 mg"
    assert pricing.strength_of("Oxytocin 10 IU/ml") == "10 IU"


def test_french_salt_names():
    assert pricing.french_base("FUMARATE DE QUÉTIAPINE") == "QUÉTIAPINE"
    assert pricing.french_base("MALÉATE D'ÉNALAPRIL") == "ÉNALAPRIL"
    assert pricing.french_base("ÉNOXAPARINE SODIQUE ") == "ÉNOXAPARINE"


def test_one_family_for_every_spelling():
    assert pricing.family("Xylometazoline hydrochloride") == pricing.family("Ksilometazolin")
    assert pricing.family("Bromhexine") == pricing.family("Bromgeksin")
    assert pricing.family("Dapagliflozin Propanediol") == pricing.family("Dapagliflozin")
    assert pricing.family("Paracetamol + Caffeine") == pricing.family("Caffeine/Paracetamol")
    assert pricing.family("Amoxicillin + Clavulanic acid") == pricing.family("Amoxicillin Trihydrate + Potassium Clavulanate")
    assert pricing.family("Cetirizine") == pricing.family("Setirizin")
    assert pricing.family("Metformin") != pricing.family("Metronidazole")
    assert pricing.units_in("Safcor 2.5mg Tablet · 1× 14’s") == 14


def test_messy_registry_names_resolve_only_when_sure():
    singles = [pricing.family(x) for x in ["telmisartan", "sildenafil", "moxifloxacin", "clobetasol", "gentamicin", "sulfadoxine",
                                           "pyrimethamine", "paracetamol", "diclofenac", "prednisone", "esomeprazole"]]
    assert pricing.ingredients("Telmirsatan", singles) == pricing.family("telmisartan")
    assert pricing.ingredients("Moxifloxacin Hydrohloride", singles) == pricing.family("moxifloxacin")
    assert pricing.ingredients("Each Film Tablet Contains: Sildenafil Citrat …", singles) == pricing.family("sildenafil")
    assert pricing.ingredients("Clobetasol Proprionate Gentamycin Sulphate", singles) == pricing.family("clobetasol + gentamicin")
    assert pricing.ingredients("Sulfadoxine Pyrimethamine", singles) == pricing.family("sulfadoxine + pyrimethamine")
    assert pricing.ingredients("Paracetamol Diclofenac Serratiopeptidase", singles) is None     # one ingredient unknown
    assert pricing.ingredients("Prednisolone", singles) is None                               # not prednisone
    assert pricing.ingredients("Omeprazole", singles) is None                                 # not esomeprazole


def test_pack_counts_written_with_x():
    assert pricing.units_in("Teva Amlodipine 5mg X28") == 28
    assert pricing.units_in("Amoxilite 500mg Cap · 10x10's") == 100
    assert pricing.units_in("Benza-200 Tablets (Albendazole) 200mg · 1 x 2’s") == 2       # not a pack of 200
    assert pricing.unit_of("Teva Amlodipine 5mg X28") == "tablet or capsule"


def test_sanity_reads_shop_prices_per_tablet_and_drops_errors():
    def o(c, price, units, kind="cap"):
        return dict(c=c, m="amlodipin", unit="tablet or capsule", strength="5 mg", units=units, price=price, usd_rate=1.0, kind=kind)
    obs = [o("A", 3.0, 30), o("B", 3.3, 30), o("C", 2.7, 30), o("D", 3.0, 30),
           o("E", 0.1, 30, "retail"),          # a shop's price for one tablet, divided by 30 by mistake
           o("F", 300.0, 30)]                  # a data error: a thousand times too dear
    kept = {x["c"]: x for x in pricing.sanity(obs)}
    assert kept["E"]["units"] == 1 and abs(kept["E"]["usd"] - 0.1) < 1e-9
    assert "F" not in kept and {"A", "B", "C", "D"} <= set(kept)


def test_bottle_and_tube_sizes():
    assert pricing.volume_of("ВИЗИПРЕС Капли глазные 2% 5мл флакон-капельницы") == (5.0, "ml")
    assert pricing.volume_of("Amoxicillin 250mg/5ml suspension 100ml") == (100.0, "ml")     # not the 5 ml of the strength
    assert pricing.volume_of("БРОКСИНАК Капли глазные 0,09% 1.7мл") == (1.7, "ml")
    assert pricing.volume_of("Diclofenac 1% gel 50г") == (50.0, "g")


def test_pack_counts_from_east_african_shops():
    assert pricing.units_in("Artefan 80/480 Tabs 6's") == 6                     # not the 480 of a strength
    assert pricing.units_in("Zocon 150mg Fluconazole Antifungal Tablets - 1 Single Tablet") == 1
    assert pricing.units_in("Amtas 5mg Amlodipine Antihypertensive Tablets - 1 Strip of 10 Tablets") == 10
    assert pricing.units_in("Vitabiotics Neurozan - 1 Pack of 30 Tablets") == 30


def test_form_types_for_price_gaps():
    assert pricing.form_type("tablet or capsule", "Amlodipine 5mg") == "tablet"
    assert pricing.form_type("ml", "Ivytimol 0.5% Timolol Glaucoma Eye Drops - 10ml Bottle") == "eye"
    assert pricing.form_type("ml", "Otrivin nasal spray 10 ml") == "nasal"
    assert pricing.form_type("g", "Canestal 1% Clotrimazole Antifungal Cream - 15g Tube") == "topical"
    assert pricing.form_type("ml", "Azilin 200mg/5ml Azithromycin Pediatric Suspension - 100ml") == "oral liquid"
    assert pricing.form_type("ampoule or vial", "Ceftriaxone 1g") == "injection"


def test_a_page_that_does_not_load_is_skipped_and_a_site_that_stops_answering_is_left_for_next_run():
    import requests
    calls = []

    class S:
        def get(self, url, **kw):
            calls.append(url)
            if "slow" in url:
                raise requests.exceptions.ConnectTimeout(url)
            return "ok"

    pricing.fresh_run()
    assert pricing.page(S(), "https://shop.test/slow-1") is None
    assert pricing.page(S(), "https://shop.test/fine") == "ok"          # one slow page: the rest still read
    for i in range(pricing.DOWN_AFTER):
        pricing.page(S(), f"https://shop.test/slow-{i}")
    assert pricing.DOWN == {"shop.test"}
    asked = len(calls)
    assert pricing.page(S(), "https://shop.test/fine") is None and len(calls) == asked     # down: not asked again this run
    assert pricing.page(S(), "https://other.test/fine") == "ok"
    pricing.fresh_run()
    assert not pricing.DOWN


def test_ampoule_doses_box_notes_and_inflected_names():
    assert pricing.dose_of("ОНО Раствор для инъекций 2 мг/мл 2мл ампулы №5(1x5)") == "4 mg"    # 2 mg/ml x 2 ml
    assert pricing.dose_of("Gentamicin 40mg/ml 2ml x10 amps") == "80 mg"
    assert pricing.dose_of("Раствор для инъекций, 4 мг/2 мл, 2 мл, №5") == "4 mg"             # already the dose
    assert pricing.dose_of("Ceftriaxone 1g vial") == "1000 mg"
    t = pricing.BOX.sub(" ", "Antazol 0.1% Nasal Drop · 15 ml drop: ৳ 20.00 (12's pack: ৳ 240.00) · nasal spray or drops")
    assert pricing.unit_of(t) == "pack" and pricing.units_in(t) == 1 and pricing.volume_of(t) == (15.0, "ml")   # one bottle
    words = {"цефтриаксон", "ceftriaxone"}
    assert pricing.product_key("Цефтриаксона натриевая соль 1 г", words, 7) == "#7"         # the ingredient, inflected
    assert pricing.product_key("Аксон 1 гр", words, 8) == "аксон"


def test_sanity_keeps_cheap_generic_packs_and_bottles():
    def o(c, price, units, unit="tablet or capsule", kind="cap"):
        return dict(c=c, m="prednisolon", unit=unit, strength="5 mg", units=units, price=price, usd_rate=1.0, kind=kind)
    obs = [o("A", 3.0, 10), o("B", 3.3, 10), o("C", 2.7, 10), o("D", 3.0, 10),
           o("E", 0.6, 10, kind="retail"),                    # a cheap generic: a fifth of the others, a real pack price
           o("F", 3.0, 10, unit="ml", kind="retail")]         # a 10 ml bottle at 3: never one ml at 3
    kept = {x["c"]: x for x in pricing.sanity(obs)}
    assert kept["E"]["units"] == 10 and kept["F"]["units"] == 10


def test_tanzanian_labels():
    assert pricing.volume_of("Calpo Suspension -100mils") == (100.0, "ml")                 # 'mils' and 'mls' are ml
    assert pricing.volume_of("Otrivin Adult Nasal Drops - 10mls") == (10.0, "ml")
    assert pricing.units_in("Gofen 400 Capsules - 10's") == 10                             # the brand's 400 is no count
    assert pricing.units_in("Vitamin C 1000mg 110 Tablets") == 110
    assert pricing.units_in("Artefan 40/240 tablets6s") == 6
    assert pricing.units_in("Azuma 500mg Azithromycin Antibiotic Tablets - 1 Strip of 3 Tablets") == 3


def test_liki_pharmacy_prices():
    card = '<div class="drugstore-card__product-price">{} <small>сум</small></div>'
    page = ("<h1>Амлодипин Озон таблетки по 5 мг №30: цена в Ташкенте</h1>"
            + "".join(card.format(p) for p in ("6 200", "6 200", "9 000", "15 000")))
    assert pricing.liki_prices(page) == ("Амлодипин Озон таблетки по 5 мг №30", [6200.0, 6200.0, 9000.0, 15000.0])


def test_shops_that_mix_tablet_and_pack_prices():
    def o(c, price, units, mixed=False):
        return dict(c=c, m="montelukast", unit="tablet or capsule", strength="10 mg", units=units, price=price, usd_rate=1.0,
                    kind="retail", mixed=mixed)
    others = [o("A", 60.0, 1), o("B", 66.0, 1), o("C", 54.0, 1)]                # about 60 a tablet elsewhere
    kept = {x["price"]: x for x in pricing.sanity(others + [o("K", 72.0, 14, True), o("K", 860.0, 14, True),
                                                             o("K", 150.0, 3, True), o("K", 9.0, 14, True)])}
    assert kept[72.0]["units"] == 1            # 72 for a 14-pack: one tablet's price
    assert kept[860.0]["units"] == 14          # 860 for a 14-pack: the pack's
    assert 150.0 not in kept                   # 150 for 3: 50 a tablet or 150 a tablet, both near 60: left out
    assert 9.0 not in kept                     # fits neither


def test_a_name_names_its_medicine_before_its_description():
    n = pricing.Names.__new__(pricing.Names)
    n.inn = type("I", (), {"find": staticmethod(lambda *t: sorted({w for x in t for w in (1, 2) if ("albendazole", "mebendazole")[w - 1] in (x or "").lower()}))})()
    n.fam, n.combos, n.brand = {1: "albendazol", 2: "mebendazol"}, {}, {}
    assert n.find("Albendazole 400mg Tablets", "Treats worms, like mebendazole") == 1
    assert n.find("Zentel 400mg", "Contains albendazole") == 1
