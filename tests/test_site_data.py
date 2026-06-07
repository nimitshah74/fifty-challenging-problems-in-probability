from __future__ import annotations

import importlib.util
import json
import re
import unittest
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    spec = importlib.util.spec_from_file_location("build_site_data", ROOT / "tools" / "build_site_data.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load tools/build_site_data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_generated_payload() -> dict:
    text = (ROOT / "assets" / "problems.js").read_text(encoding="utf-8")
    match = re.search(r"window\.PROBLEM_DATA = (.*);\s*$", text, re.DOTALL)
    if not match:
        raise AssertionError("assets/problems.js does not expose window.PROBLEM_DATA")
    return json.loads(match.group(1))


def path_exists_case_sensitive(relative_path: str) -> bool:
    current = ROOT
    for part in PurePosixPath(relative_path).parts:
        entries = {child.name: child for child in current.iterdir()}
        if part not in entries:
            return False
        current = entries[part]
    return current.is_file()


class SiteDataTests(unittest.TestCase):
    def test_generated_payload_is_current(self) -> None:
        builder = load_builder()
        self.assertEqual(load_generated_payload(), builder.build_payload())

    def test_all_problem_numbers_are_represented(self) -> None:
        payload = load_generated_payload()
        self.assertEqual(payload["totalCount"], 50)
        self.assertEqual([problem["number"] for problem in payload["problems"]], list(range(1, 51)))
        self.assertEqual(payload["availableCount"], 46)
        self.assertEqual(payload["missingNumbers"], [46, 47, 48, 49])

    def test_available_problems_have_required_sections(self) -> None:
        for problem in load_generated_payload()["problems"]:
            if not problem["available"]:
                continue
            self.assertTrue(problem["notebook"], f"Problem {problem['number']} has no notebook")
            self.assertTrue(problem["problemMarkdown"].strip(), f"Problem {problem['number']} has no statement")
            self.assertTrue(problem["solutionMarkdown"].strip(), f"Problem {problem['number']} has no solution")

    def test_markdown_image_paths_exist_case_sensitively(self) -> None:
        image_pattern = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
        for problem in load_generated_payload()["problems"]:
            markdown = "\n".join([problem["problemMarkdown"], problem["solutionMarkdown"]])
            for image_path in image_pattern.findall(markdown):
                if re.match(r"^[a-z][a-z0-9+.-]*:", image_path, re.IGNORECASE):
                    continue
                self.assertTrue(
                    path_exists_case_sensitive(image_path),
                    f"Problem {problem['number']} references missing image {image_path}",
                )

    def test_index_contains_required_interface_hooks(self) -> None:
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        for expected in [
            'id="problem-grid"',
            'id="show-solution"',
            'id="show-code"',
            'assets/problems.js',
            'assets/app.js',
        ]:
            self.assertIn(expected, index)


if __name__ == "__main__":
    unittest.main()
