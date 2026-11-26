import os
import unittest
from unittest.mock import patch

from backend.config import Settings


class PolicyConfigTests(unittest.TestCase):
    def test_policy_configuration_and_bounds(self):
        with patch.dict(os.environ, {"ML_MODE": "mock", "SANA_POLICY_VERSION": "local-test",
                                     "SANA_HOLD_THRESHOLD": "80", "SANA_RING_CONFIDENCE": "0.85"}, clear=True):
            policy = Settings.from_env().policy
            self.assertEqual((policy.version, policy.hold_threshold, policy.ring_confidence),
                             ("local-test", 80, .85))
            for key, invalid in (("SANA_STEP_UP_THRESHOLD", "85"), ("SANA_RING_CONFIDENCE", "nan"),
                                 ("SANA_HANDOFF_AMOUNT", "-1"), ("SANA_POLICY_VERSION", "")):
                with self.subTest(setting=key), patch.dict(os.environ, {key: invalid}):
                    with self.assertRaises(ValueError):
                        Settings.from_env()
