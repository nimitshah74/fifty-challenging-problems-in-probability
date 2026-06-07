"""Build browser data for the GitHub Pages interface.

The source of truth is the collection of Jupyter notebooks in the repository
root. Each notebook is split at the markdown divider line used by the existing
solutions: content before the divider is the problem, and content after it is
the written solution. Code cells are kept separately for the code-solution tab.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "problems.js"
NOTEBOOK_PATTERN = re.compile(r"^(?P<number>\d+)-Solution\.ipynb$")
DIVIDER_PATTERN = re.compile(r"^\s*_{3,}\s*$", re.MULTILINE)
MARKDOWN_IMAGE_PATTERN = re.compile(r"(!\[[^\]]*\]\()([^)]+)(\))")
HTML_IMAGE_PATTERN = re.compile(r'(<img[^>]+src=["\'])([^"\']+)(["\'])', re.IGNORECASE)


def cell_source(cell: dict[str, Any]) -> str:
    source = cell.get("source", "")
    if isinstance(source, list):
        return "".join(source)
    return str(source)


def strip_markdown(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
    text = re.sub(r"\[[^\]]+\]\(([^)]+)\)", "", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"[*_~#>`]", "", text)
    text = re.sub(r"^\s*[-+*]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def first_meaningful_line(markdown: str) -> str:
    for line in markdown.splitlines():
        cleaned = strip_markdown(line)
        if cleaned:
            return cleaned
    return ""


def extract_title(number: int, problem_markdown: str) -> str:
    for line in problem_markdown.splitlines():
        match = re.match(r"^\s*#\s+(.+?)\s*$", line)
        if match:
            return strip_markdown(match.group(1)) or f"Problem {number:02d}"
    return f"Problem {number:02d}"


def build_case_map() -> dict[str, str]:
    case_map: dict[str, str] = {}
    for path in (ROOT / "images").glob("*"):
        if path.is_file():
            relative_path = path.relative_to(ROOT).as_posix()
            case_map[relative_path.lower()] = relative_path
    return case_map


def normalize_asset_path(path: str, case_map: dict[str, str]) -> str:
    if re.match(r"^[a-z][a-z0-9+.-]*:", path, re.IGNORECASE):
        return path
    lookup = path.split("#", 1)[0].split("?", 1)[0].lower()
    return case_map.get(lookup, path)


def normalize_markdown(markdown: str, case_map: dict[str, str]) -> str:
    markdown = markdown.replace("\r\n", "\n")

    def replace_markdown_image(match: re.Match[str]) -> str:
        return f"{match.group(1)}{normalize_asset_path(match.group(2), case_map)}{match.group(3)}"

    def replace_html_image(match: re.Match[str]) -> str:
        return f"{match.group(1)}{normalize_asset_path(match.group(2), case_map)}{match.group(3)}"

    markdown = MARKDOWN_IMAGE_PATTERN.sub(replace_markdown_image, markdown)
    return HTML_IMAGE_PATTERN.sub(replace_html_image, markdown)


def split_notebook(notebook: dict[str, Any], case_map: dict[str, str]) -> tuple[str, str, list[dict[str, Any]]]:
    problem_parts: list[str] = []
    solution_parts: list[str] = []
    code_cells: list[dict[str, Any]] = []
    in_solution = False

    for cell in notebook.get("cells", []):
        source = cell_source(cell).strip()
        if not source:
            continue

        if cell.get("cell_type") == "code":
            code_cells.append(
                {
                    "executionCount": cell.get("execution_count"),
                    "source": source,
                }
            )
            continue

        if cell.get("cell_type") != "markdown":
            continue

        divider = DIVIDER_PATTERN.search(source)
        if divider:
            before = source[: divider.start()].strip()
            after = source[divider.end() :].strip()
            if before:
                problem_parts.append(before)
            in_solution = True
            if after:
                solution_parts.append(after)
            continue

        if in_solution:
            solution_parts.append(source)
        else:
            problem_parts.append(source)

    problem_markdown = normalize_markdown("\n\n".join(problem_parts), case_map)
    solution_markdown = normalize_markdown("\n\n".join(solution_parts), case_map)
    return problem_markdown, solution_markdown, code_cells


def load_problem(path: Path, case_map: dict[str, str]) -> dict[str, Any]:
    match = NOTEBOOK_PATTERN.match(path.name)
    if not match:
        raise ValueError(f"Unexpected notebook name: {path.name}")

    number = int(match.group("number"))
    notebook = json.loads(path.read_text(encoding="utf-8"))
    problem_markdown, solution_markdown, code_cells = split_notebook(notebook, case_map)
    title = extract_title(number, problem_markdown)
    summary = first_meaningful_line(problem_markdown)

    return {
        "number": number,
        "id": f"problem-{number:02d}",
        "available": True,
        "title": title,
        "summary": summary,
        "notebook": path.name,
        "problemMarkdown": problem_markdown,
        "solutionMarkdown": solution_markdown,
        "codeCells": code_cells,
    }


def missing_problem(number: int) -> dict[str, Any]:
    return {
        "number": number,
        "id": f"problem-{number:02d}",
        "available": False,
        "title": f"Problem {number:02d}",
        "summary": "Notebook not present in this repository.",
        "notebook": None,
        "problemMarkdown": (
            f"Problem {number:02d} is not available in this repository. "
            "The current source notebooks include problems 01–45 and 50 only."
        ),
        "solutionMarkdown": "",
        "codeCells": [],
    }


def build_payload() -> dict[str, Any]:
    case_map = build_case_map()
    discovered: dict[int, dict[str, Any]] = {}

    for path in sorted(ROOT.glob("*-Solution.ipynb")):
        problem = load_problem(path, case_map)
        discovered[problem["number"]] = problem

    problems = [discovered.get(number, missing_problem(number)) for number in range(1, 51)]
    missing_numbers = [problem["number"] for problem in problems if not problem["available"]]

    return {
        "bookTitle": "Fifty Challenging Problems in Probability",
        "sourceRepository": "nimitshah74/fifty-challenging-problems-in-probability",
        "availableCount": len(discovered),
        "totalCount": 50,
        "missingNumbers": missing_numbers,
        "problems": problems,
    }


def main() -> None:
    payload = build_payload()
    serialized = json.dumps(payload, ensure_ascii=False, indent=2).replace("</", "<\\/")
    OUTPUT.write_text(
        "// Generated by tools/build_site_data.py. Do not edit by hand.\n"
        f"window.PROBLEM_DATA = {serialized};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT.relative_to(ROOT).as_posix()} with {payload['availableCount']} notebooks.")


if __name__ == "__main__":
    main()
