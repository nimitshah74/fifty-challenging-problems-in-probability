const data = window.PROBLEM_DATA;

const elements = {
  availableCount: document.querySelector("#available-count"),
  clearSearch: document.querySelector("#clear-search"),
  codePanel: document.querySelector("#code-panel"),
  coverageNote: document.querySelector("#coverage-note"),
  emptyState: document.querySelector("#empty-state"),
  notebookLink: document.querySelector("#notebook-link"),
  openNotebook: document.querySelector("#open-notebook"),
  problemActions: document.querySelector("#problem-actions"),
  problemCard: document.querySelector("#problem-card"),
  problemGrid: document.querySelector("#problem-grid"),
  problemKicker: document.querySelector("#problem-kicker"),
  problemPanel: document.querySelector("#problem-panel"),
  problemSearch: document.querySelector("#problem-search"),
  problemTitle: document.querySelector("#problem-title"),
  showCode: document.querySelector("#show-code"),
  showProblem: document.querySelector("#show-problem"),
  showSolution: document.querySelector("#show-solution"),
  solutionPanel: document.querySelector("#solution-panel"),
};

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";
const IMPORT_PACKAGE_MAP = {
  matplotlib: "matplotlib",
  numpy: "numpy",
  pandas: "pandas",
  scipy: "scipy",
};

let selectedProblem = null;
let activeView = "problem";
let searchTerm = "";
let pyodidePromise = null;
let runtimeReadyForProblem = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(markdown) {
  if (!markdown) {
    return "<p>No content is available for this section.</p>";
  }

  if (window.marked) {
    return window.marked.parse(markdown, { breaks: false, gfm: true });
  }

  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function typesetMath() {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([elements.problemCard]).catch(() => {});
  }
}

function problemLabel(problem) {
  return `Problem ${String(problem.number).padStart(2, "0")}`;
}

function problemMatchesSearch(problem) {
  if (!searchTerm) {
    return true;
  }

  const haystack = [
    problem.number,
    problem.title,
    problem.summary,
    problem.problemMarkdown,
    problem.solutionMarkdown,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchTerm);
}

function renderProblemGrid() {
  const visibleProblems = data.problems.filter(problemMatchesSearch);
  elements.problemGrid.innerHTML = "";

  for (const problem of visibleProblems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "problem-number";
    button.dataset.number = problem.number;
    button.setAttribute("aria-label", `${problemLabel(problem)} ${problem.title}`);
    button.innerHTML = `
      <span>${String(problem.number).padStart(2, "0")}</span>
      <small>${escapeHtml(problem.available ? problem.title : "Missing")}</small>
    `;

    if (!problem.available) {
      button.classList.add("missing");
    }

    if (selectedProblem?.number === problem.number) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => selectProblem(problem.number, true));
    elements.problemGrid.appendChild(button);
  }

  if (visibleProblems.length === 0) {
    elements.problemGrid.innerHTML = '<p class="no-results">No matching problems found.</p>';
  }
}

function notebookHref(problem) {
  return problem.notebook ? `./${problem.notebook}` : "#";
}

function packagesForCode(source) {
  const packages = new Set();

  for (const [moduleName, packageName] of Object.entries(IMPORT_PACKAGE_MAP)) {
    const importPattern = new RegExp(`(^|\\n)\\s*(import\\s+${moduleName}\\b|from\\s+${moduleName}\\b)`);
    if (importPattern.test(source)) {
      packages.add(packageName);
    }
  }

  return [...packages];
}

function setRuntimeStatus(message, state = "idle") {
  const status = document.querySelector("#runtime-status");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = state;
}

function setRunnerButtonsDisabled(disabled) {
  document.querySelectorAll(".runner-button").forEach((button) => {
    button.disabled = disabled;
  });
}

async function getPyodideRuntime() {
  if (!window.loadPyodide) {
    throw new Error("Pyodide did not load. Check your internet connection and reload the page.");
  }

  if (!pyodidePromise) {
    setRuntimeStatus("Loading Python runtime…", "running");
    pyodidePromise = window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  }

  return pyodidePromise;
}

async function prepareRuntime(problem) {
  const pyodide = await getPyodideRuntime();

  if (runtimeReadyForProblem === problem.id) {
    return pyodide;
  }

  setRuntimeStatus(`Preparing Python for ${problemLabel(problem)}…`, "running");
  pyodide.runPython(`
import ast
import base64
import io
import json
import traceback
from contextlib import redirect_stderr, redirect_stdout

_notebook_namespace = {"__name__": "__main__"}

def _clean_user_code(code):
    cleaned_lines = []
    for line in code.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("%matplotlib"):
            continue
        if stripped.startswith("%") or stripped.startswith("!"):
            cleaned_lines.append("# Skipped notebook-only command: " + line)
        else:
            cleaned_lines.append(line)
    return "\\n".join(cleaned_lines)

def _exec_like_notebook(code, namespace):
    tree = ast.parse(code, mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expression = ast.Expression(tree.body.pop().value)
        ast.fix_missing_locations(tree)
        ast.fix_missing_locations(last_expression)
        if tree.body:
            exec(compile(tree, "<browser-notebook-cell>", "exec"), namespace)
        result = eval(compile(last_expression, "<browser-notebook-cell>", "eval"), namespace)
        if result is not None:
            print(repr(result))
    else:
        exec(compile(tree, "<browser-notebook-cell>", "exec"), namespace)

def _collect_matplotlib_images():
    images = []
    try:
        import matplotlib
        matplotlib.use("agg", force=True)
        import matplotlib.pyplot as plt

        for figure_number in plt.get_fignums():
            figure = plt.figure(figure_number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
        plt.close("all")
    except Exception:
        pass
    return images

def _run_user_code(code):
    stdout = io.StringIO()
    stderr = io.StringIO()
    payload = {
        "success": True,
        "stdout": "",
        "stderr": "",
        "error": "",
        "images": [],
    }

    try:
        cleaned_code = _clean_user_code(code)
        with redirect_stdout(stdout), redirect_stderr(stderr):
            _exec_like_notebook(cleaned_code, _notebook_namespace)
    except Exception:
        payload["success"] = False
        payload["error"] = traceback.format_exc()
    finally:
        payload["stdout"] = stdout.getvalue()
        payload["stderr"] = stderr.getvalue()
        payload["images"] = _collect_matplotlib_images()

    return json.dumps(payload)
`);

  runtimeReadyForProblem = problem.id;
  setRuntimeStatus(`Python ready for ${problemLabel(problem)}.`, "success");
  return pyodide;
}

function renderCodeCells(problem) {
  if (!problem.codeCells.length) {
    return '<div class="notice">No code cells are present for this notebook.</div>';
  }

  const controls = `
    <div class="code-runner">
      <div>
        <p class="code-runner__title">Runnable Python</p>
        <p class="code-runner__note">
          Runs in your browser with Pyodide. State is shared across cells, like a notebook kernel.
          Heavy simulations may take longer than they do locally.
        </p>
      </div>
      <div class="code-runner__actions">
        <button class="copy-all" type="button" id="copy-code">Copy All Code</button>
        <button class="runner-button" type="button" id="run-all-code">Run All</button>
        <button class="runner-button ghost-runner" type="button" id="reset-python">Reset Runtime</button>
      </div>
      <div class="runtime-status" id="runtime-status" data-state="idle">Python loads on first run.</div>
    </div>
  `;
  const codeCells = problem.codeCells
    .map((cell, index) => {
      const label = cell.executionCount ? `Cell ${index + 1} · In [${cell.executionCount}]` : `Cell ${index + 1}`;
      return `
        <section class="code-cell">
          <div class="code-cell__header">
            <span>${escapeHtml(label)}</span>
            <button class="runner-button run-cell" type="button" data-cell-index="${index}">Run Cell</button>
          </div>
          <pre><code>${escapeHtml(cell.source)}</code></pre>
          <div class="cell-output" id="cell-output-${index}" aria-live="polite"></div>
        </section>
      `;
    })
    .join("");

  return `${controls}${codeCells}`;
}

function renderCellOutput(outputElement, result) {
  const status = result.success
    ? '<div class="cell-output__status success">Finished</div>'
    : '<div class="cell-output__status error">Error</div>';
  const stdout = result.stdout ? `<pre class="cell-output__stream">${escapeHtml(result.stdout)}</pre>` : "";
  const stderr = result.stderr ? `<pre class="cell-output__stream warning">${escapeHtml(result.stderr)}</pre>` : "";
  const error = result.error ? `<pre class="cell-output__stream error">${escapeHtml(result.error)}</pre>` : "";
  const images = result.images
    .map((image, index) => `<img src="data:image/png;base64,${image}" alt="Matplotlib output ${index + 1}" />`)
    .join("");

  outputElement.innerHTML = `${status}${stdout}${stderr}${error}${images}`;
}

async function executeCodeCell(problem, cellIndex) {
  const outputElement = document.querySelector(`#cell-output-${cellIndex}`);
  if (!outputElement) {
    return;
  }

  outputElement.innerHTML = '<div class="cell-output__status running">Running…</div>';
  const cell = problem.codeCells[cellIndex];
  const packages = packagesForCode(cell.source);
  const pyodide = await prepareRuntime(problem);

  if (packages.length) {
    setRuntimeStatus(`Loading ${packages.join(", ")}…`, "running");
    await pyodide.loadPackage(packages);
    if (packages.includes("matplotlib")) {
      pyodide.runPython('import matplotlib; matplotlib.use("agg", force=True)');
    }
  }

  setRuntimeStatus(`Running cell ${cellIndex + 1}…`, "running");
  pyodide.globals.set("__USER_CODE__", cell.source);
  const result = JSON.parse(await pyodide.runPythonAsync("_run_user_code(__USER_CODE__)"));
  renderCellOutput(outputElement, result);
  setRuntimeStatus(result.success ? `Finished cell ${cellIndex + 1}.` : `Cell ${cellIndex + 1} failed.`, result.success ? "success" : "error");
}

function bindCodeButtons(problem) {
  const copyButton = document.querySelector("#copy-code");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const allCode = problem.codeCells.map((cell) => cell.source).join("\n\n");
      await navigator.clipboard.writeText(allCode);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy All Code";
      }, 1200);
    });
  }

  document.querySelectorAll(".run-cell").forEach((button) => {
    button.addEventListener("click", async () => {
      setRunnerButtonsDisabled(true);
      try {
        await executeCodeCell(problem, Number(button.dataset.cellIndex));
      } catch (error) {
        setRuntimeStatus(error.message, "error");
      } finally {
        setRunnerButtonsDisabled(false);
      }
    });
  });

  const runAllButton = document.querySelector("#run-all-code");
  if (runAllButton) {
    runAllButton.addEventListener("click", async () => {
      setRunnerButtonsDisabled(true);
      runtimeReadyForProblem = null;
      document.querySelectorAll(".cell-output").forEach((output) => {
        output.innerHTML = "";
      });

      try {
        for (let index = 0; index < problem.codeCells.length; index += 1) {
          await executeCodeCell(problem, index);
        }
        setRuntimeStatus(`Finished all ${problem.codeCells.length} cells.`, "success");
      } catch (error) {
        setRuntimeStatus(error.message, "error");
      } finally {
        setRunnerButtonsDisabled(false);
      }
    });
  }

  const resetButton = document.querySelector("#reset-python");
  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      setRunnerButtonsDisabled(true);
      try {
        runtimeReadyForProblem = null;
        await prepareRuntime(problem);
        document.querySelectorAll(".cell-output").forEach((output) => {
          output.innerHTML = "";
        });
        setRuntimeStatus(`Runtime reset for ${problemLabel(problem)}.`, "success");
      } catch (error) {
        setRuntimeStatus(error.message, "error");
      } finally {
        setRunnerButtonsDisabled(false);
      }
    });
  }
}

function setActiveView(view) {
  activeView = view;

  const viewMap = {
    problem: [elements.showProblem, elements.problemPanel],
    solution: [elements.showSolution, elements.solutionPanel],
    code: [elements.showCode, elements.codePanel],
  };

  for (const [name, [button, panel]] of Object.entries(viewMap)) {
    button.classList.toggle("active", name === activeView);
    button.setAttribute("aria-selected", String(name === activeView));
    panel.classList.toggle("hidden", name !== activeView);
  }

  typesetMath();
}

function updateDetail() {
  if (!selectedProblem) {
    elements.emptyState.classList.remove("hidden");
    elements.problemCard.classList.add("hidden");
    return;
  }

  const problem = selectedProblem;
  elements.emptyState.classList.add("hidden");
  elements.problemCard.classList.remove("hidden");
  elements.problemKicker.textContent = problemLabel(problem);
  elements.problemTitle.textContent = problem.title;
  elements.problemPanel.innerHTML = renderMarkdown(problem.problemMarkdown);
  elements.solutionPanel.innerHTML = renderMarkdown(problem.solutionMarkdown);
  elements.codePanel.innerHTML = renderCodeCells(problem);

  elements.problemActions.classList.toggle("hidden", !problem.available);
  elements.openNotebook.classList.toggle("hidden", !problem.available);
  elements.openNotebook.href = notebookHref(problem);
  elements.notebookLink.textContent = problem.available ? `Source notebook: ${problem.notebook}` : "No source notebook exists.";

  bindCodeButtons(problem);
  setActiveView(problem.available ? activeView : "problem");
}

function selectProblem(number, updateHash = false) {
  selectedProblem = data.problems.find((problem) => problem.number === Number(number)) ?? null;
  activeView = "problem";
  runtimeReadyForProblem = null;
  renderProblemGrid();
  updateDetail();

  if (selectedProblem && updateHash) {
    history.replaceState(null, "", `#${selectedProblem.id}`);
  }
}

function initialProblemNumber() {
  const match = window.location.hash.match(/problem-(\d+)/);
  if (match) {
    return Number(match[1]);
  }
  return null;
}

function bindActions() {
  elements.showProblem.addEventListener("click", () => setActiveView("problem"));
  elements.showSolution.addEventListener("click", () => setActiveView("solution"));
  elements.showCode.addEventListener("click", () => setActiveView("code"));

  elements.problemSearch.addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLowerCase();
    renderProblemGrid();
  });

  elements.clearSearch.addEventListener("click", () => {
    searchTerm = "";
    elements.problemSearch.value = "";
    renderProblemGrid();
  });

  window.addEventListener("hashchange", () => {
    const number = initialProblemNumber();
    if (number) {
      selectProblem(number);
    }
  });
}

function init() {
  elements.availableCount.textContent = data.availableCount;
  elements.coverageNote.textContent = data.missingNumbers.length
    ? `Missing notebooks: ${data.missingNumbers.map((number) => String(number).padStart(2, "0")).join(", ")}.`
    : "Every numbered notebook is available.";

  bindActions();
  renderProblemGrid();

  const number = initialProblemNumber();
  if (number) {
    selectProblem(number);
  }
}

init();
