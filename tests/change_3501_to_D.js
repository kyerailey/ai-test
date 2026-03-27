(function() {
    // 1. Find the target course row (CSC 3501)
    const rows = document.querySelectorAll('tr[data-automation-id="row"]');
    let targetRow = null;

    rows.forEach(row => {
        if (row.innerText.includes("CSC 3501")) {
            targetRow = row;
        }
    });

    if (!targetRow) {
        console.error("CSC 3501 not found.");
        return;
    }

    // 2. Change the Grade to 'D' (from previous step)
    const cells = targetRow.querySelectorAll('td[data-automation-id="cell"]');
    cells.forEach(cell => {
        const gradeContainer = cell.querySelector('[data-automation-id="promptOption"]');
        if (gradeContainer && (/^[A-F][+-]?(\s?\(.*\))?$/.test(gradeContainer.innerText.trim()) || gradeContainer.innerText.trim() === "IP")) {
            gradeContainer.innerText = "D";
            gradeContainer.setAttribute('data-automation-label', 'D');
            gradeContainer.style.backgroundColor = "yellow";
        }
    });

    // 3. Find the Requirement Header Row sitting above this course to change Status
    let headerRow = targetRow.previousElementSibling;
    // Walk up until we find the row containing the "Satisfied" status
    while (headerRow && !headerRow.innerText.includes("Satisfied")) {
        headerRow = headerRow.previousElementSibling;
    }

    if (headerRow) {
        // Find the "Satisfied" text and change it to "In Progress"
        const walker = document.createTreeWalker(headerRow, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim() === "Satisfied") {
                node.textContent = "In Progress";
                // Color it orange to match your extension's "In Progress" logic
                node.parentElement.style.color = "orange";
                node.parentElement.style.fontWeight = "bold";
            }
        }
        console.log("Success: CSC 3501 grade set to 'D' and Section Status set to 'In Progress'.");
    } else {
        console.error("Could not find the 'Satisfied' header row above CSC 3501.");
    }
})();
