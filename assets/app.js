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

let selectedProblem = null;
let activeView = "problem";
let searchTerm = "";

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

function renderCodeCells(problem) {
  if (!problem.codeCells.length) {
    return '<div class="notice">No code cells are present for this notebook.</div>';
  }

  const copyAll = `<button class="copy-all" type="button" id="copy-code">Copy All Code</button>`;
  const codeCells = problem.codeCells
    .map((cell, index) => {
      const label = cell.executionCount ? `Cell ${index + 1} · In [${cell.executionCount}]` : `Cell ${index + 1}`;
      return `
        <section class="code-cell">
          <div class="code-cell__header">${escapeHtml(label)}</div>
          <pre><code>${escapeHtml(cell.source)}</code></pre>
        </section>
      `;
    })
    .join("");

  return `${copyAll}${codeCells}`;
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

  setActiveView(problem.available ? activeView : "problem");
}

function selectProblem(number, updateHash = false) {
  selectedProblem = data.problems.find((problem) => problem.number === Number(number)) ?? null;
  activeView = "problem";
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
