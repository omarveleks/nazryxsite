from devices import use_group


def test_groups_keep_hyaluronate_products_apart():
    assert use_group("HYLO-COMOD", "Sodium Hyaluronate", "Eye Drops") == "eye_drops"
    assert use_group("Healon GV") == "eye_surgery"
    assert use_group("Appavisc", "Hydroxyl Propyl Methylcellulose 2% opthalmic soulution") == "eye_surgery"
    assert use_group("Sodium hyaluronate 2% intra-articular injection") == "joint"
    assert use_group("Sterimar Nose Hygiene Isotonic 100ml") == "nasal"
    assert use_group("NeilMed Sinus Rinse") == "nasal"


def test_hardware_is_not_grouped():
    assert use_group("Akshar Nasal Oxygen Cannula") is None
    assert use_group("Genius Retaining Knee system") is None
    assert use_group("Intraocular lenses IOL") is None
