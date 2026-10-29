-- Works and services tenders that only mention a medical buyer ("Construction of a Wall Fence at Tanzania Vaccine Institute")
-- slipped in through the medicine word. The collector now skips them; the ones already saved go, unless they name a molecule.
delete from tenders
 where coalesce(array_length(molecule_ids, 1), 0) = 0
   and title ~* '(construct|\mbuild|renovat|rehabilitat|refurbish|\mfenc|\mwall\M|roof|paint|plumb|electrical|road|drainage|borehole|civil works|\mworks\M|vehicle|motor|tyre|furniture|printing|stationery|software|\mICT\M|computer|laptop|network|website|consultan|audit|cleaning|security (service|guard)|catering|uniform|fuel|generator|air[- ]condition|solar|cctv|insurance|ujenzi|uzio|ukarabati|jengo|magari|строительств|ремонт|реконструкц|мебел|автомоб|компьютер|программн|охран|travaux|réhabilitation|construction|véhicule|mobilier|clôture|informatique)';
