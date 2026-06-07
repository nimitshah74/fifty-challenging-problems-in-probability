from __future__ import annotations

import importlib.util
import json
import os
import re
import time
import unittest
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
LIVE_SITE_URL = os.environ.get(
    "LIVE_SITE_URL",
    "https://nimitshah74.github.io/fifty-challenging-problems-in-probability/",
)
REQUEST_TIMEOUT_SECONDS = 20


def load_builder():
    spec = importlib.util.spec_from_file_location("build_site_data", ROOT / "tools" / "build_site_data.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load tools/build_site_data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "notebook-content-parity-tests"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8")


def parse_problem_payload(javascript: str) -> dict:
    match = re.search(r"window\.PROBLEM_DATA = (.*);\s*$", javascript, re.DOTALL)
    if not match:
        raise AssertionError("Live assets/problems.js does not expose window.PROBLEM_DATA")
    return json.loads(match.group(1))


def load_live_payload() -> dict:
    cache_buster = int(time.time())
    problems_url = urljoin(LIVE_SITE_URL, f"assets/problems.js?content-parity={cache_buster}")
    return parse_problem_payload(fetch_text(problems_url))


class LiveSiteNotebookParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        builder = load_builder()
        cls.expected_payload = builder.build_payload()
        cls.live_index = fetch_text(LIVE_SITE_URL)
        cls.live_payload = load_live_payload()

    def test_live_page_loads_the_generated_problem_data(self) -> None:
        self.assertIn("assets/problems.js", self.live_index)
        self.assertIn("assets/app.js", self.live_index)
        self.assertIn("Fifty Challenging Problems in Probability", self.live_index)

    def test_live_problem_inventory_matches_notebooks(self) -> None:
        expected = self.expected_payload
        actual = self.live_payload

        for key in ["bookTitle", "sourceRepository", "availableCount", "totalCount", "missingNumbers"]:
            self.assertEqual(actual[key], expected[key], f"Live payload field {key} differs from notebooks")

        self.assertEqual(
            [problem["number"] for problem in actual["problems"]],
            [problem["number"] for problem in expected["problems"]],
        )

    def test_live_problem_statements_match_notebooks(self) -> None:
        for expected, actual in zip(self.expected_payload["problems"], self.live_payload["problems"]):
            with self.subTest(problem=expected["number"]):
                self.assertEqual(actual["problemMarkdown"], expected["problemMarkdown"])

    def test_live_written_solutions_match_notebooks(self) -> None:
        for expected, actual in zip(self.expected_payload["problems"], self.live_payload["problems"]):
            with self.subTest(problem=expected["number"]):
                self.assertEqual(actual["solutionMarkdown"], expected["solutionMarkdown"])

    def test_live_code_solutions_match_notebooks(self) -> None:
        for expected, actual in zip(self.expected_payload["problems"], self.live_payload["problems"]):
            with self.subTest(problem=expected["number"]):
                self.assertEqual(actual["codeCells"], expected["codeCells"])

    def test_live_notebook_metadata_matches_notebooks(self) -> None:
        for expected, actual in zip(self.expected_payload["problems"], self.live_payload["problems"]):
            with self.subTest(problem=expected["number"]):
                for key in ["id", "available", "title", "summary", "notebook"]:
                    self.assertEqual(actual[key], expected[key], f"Problem {expected['number']} field {key} differs")


if __name__ == "__main__":
    unittest.main()
