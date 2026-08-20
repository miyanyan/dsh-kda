import importlib.util
import pathlib
import unittest


DRIVER_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "kda_driver.py"
SPEC = importlib.util.spec_from_file_location("kda_driver", DRIVER_PATH)
assert SPEC is not None and SPEC.loader is not None
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class DriverTests(unittest.TestCase):
    def test_parse_metric_uses_last_value(self):
        self.assertEqual(DRIVER.parse_metric("KDA_METRIC=3\nKDA_METRIC=2.5", DRIVER.DEFAULT_METRIC_PATTERN), 2.5)

    def test_decision_promotes_lower_metric(self):
        request = {"baselineMetric": 10, "lowerIsBetter": True, "minimumImprovementPercent": 5}
        stages = [
            {"stage": "correctness", "ok": True},
            {"stage": "benchmark", "ok": True, "metric": 8},
        ]
        outcome, _, improvement = DRIVER.decision(request, stages)
        self.assertEqual(outcome, "promote")
        self.assertAlmostEqual(improvement, 20)


if __name__ == "__main__":
    unittest.main()
