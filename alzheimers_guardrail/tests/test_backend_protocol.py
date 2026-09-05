"""Protocol-level tests for malformed and incomplete action payloads."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.main import build_action_response  # noqa: E402


class ActionProtocolTests(unittest.TestCase):
    def test_malformed_json_returns_safe_error(self):
        self.assertEqual(build_action_response('{not json'), {'error': 'Invalid JSON'})

    def test_non_object_payload_is_rejected(self):
        response = build_action_response('[]')
        self.assertEqual(response['error'], 'Validation failed')
        self.assertIn('Request must be a JSON object', response['details'])

    def test_missing_action_is_rejected(self):
        response = build_action_response(json.dumps({'target': {}}))
        self.assertEqual(response['error'], 'Validation failed')
        self.assertIn("Missing 'action' field", response['details'])

    def test_missing_transfer_amount_is_rejected(self):
        response = build_action_response(json.dumps({
            'action': 'TRANSFER', 'target': {'recipient': 'Alice'}
        }))
        self.assertEqual(response['error'], 'Validation failed')
        self.assertIn("'amount' required for TRANSFER", response['details'])

    def test_boolean_transfer_amount_is_rejected(self):
        response = build_action_response(json.dumps({
            'action': 'TRANSFER', 'target': {'recipient': 'Alice', 'amount': True}
        }))
        self.assertEqual(response['error'], 'Validation failed')
        self.assertIn("'amount' must be a number", response['details'])

    def test_valid_action_has_context_and_privacy_audit(self):
        response = build_action_response(json.dumps({
            'action': 'SEND_DOCUMENT',
            'target': {'recipient': 'john@example.com', 'document_id': 'Medical_Report.pdf'},
        }))
        self.assertNotIn('error', response)
        self.assertGreaterEqual(response['score'], 0)
        self.assertIn('explanation', response)
        self.assertTrue(response['privacy_log']['used'])


if __name__ == '__main__':
    unittest.main()
