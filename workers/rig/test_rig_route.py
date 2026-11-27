"""Unit tests for rig_route.choose_engine: which rigger a mesh goes to.

Measured on production 2026-11-27: a katana passed the silhouette test (tall
and left-right symmetric) and came back with a 52-bone human skeleton. The
platform now sends `subject` ("humanoid" or "creature"), read from the words
the model was made from, and that answer outranks the silhouette.

No numpy, no GPU: `python3 test_rig_route.py`.
"""

from __future__ import annotations

import sys
import unittest

from rig_route import HUMAN_ENGINE, NONHUMAN_ENGINE, choose_engine, normalize_subject


class ChooseEngineTest(unittest.TestCase):
    def test_a_creature_goes_to_the_nonhuman_rigger_even_when_its_silhouette_reads_human(self):
        self.assertEqual(choose_engine("humanoid", "creature", True), NONHUMAN_ENGINE)

    def test_a_humanoid_stays_on_the_human_rigger_even_when_its_silhouette_reads_other(self):
        # A T-posed human is wider than tall, which the silhouette test calls "other".
        self.assertEqual(choose_engine("other", "humanoid", True), HUMAN_ENGINE)

    def test_without_a_subject_the_silhouette_decides(self):
        self.assertEqual(choose_engine("humanoid", None, True), HUMAN_ENGINE)
        self.assertEqual(choose_engine("other", None, True), NONHUMAN_ENGINE)

    def test_without_a_nonhuman_worker_every_mesh_takes_the_human_rigger(self):
        self.assertEqual(choose_engine("other", "creature", False), HUMAN_ENGINE)
        self.assertEqual(choose_engine("other", None, False), HUMAN_ENGINE)

    def test_an_unknown_subject_is_ignored(self):
        self.assertIsNone(normalize_subject("robot overlord"))
        self.assertIsNone(normalize_subject(""))
        self.assertIsNone(normalize_subject(None))
        self.assertEqual(normalize_subject(" Creature "), "creature")
        self.assertEqual(choose_engine("other", "robot overlord", True), NONHUMAN_ENGINE)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
