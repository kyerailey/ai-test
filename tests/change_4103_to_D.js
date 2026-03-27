(function() {
    const rows = document.querySelectorAll('tr[data-automation-id="row"]');
    let targetRow = null;

    rows.forEach(row => {
        if (row.innerText.includes("CSC 4103")) {
            targetRow = row;
        }
    });

    if (!targetRow) {
        console.error("CSC 4103 not found.");
        return;
    }

    const cells = targetRow.querySelectorAll('td[data-automation-id="cell"]');
    cells.forEach(cell => {
        const gradeContainer = cell.querySelector('[data-automation-id="promptOption"]');
        if (gradeContainer && (/^[A-F][+-]?(\s?\(.*\))?$/.test(gradeContainer.innerText.trim()) || gradeContainer.innerText.trim() === "IP")) {
            gradeContainer.innerText = "D";
            gradeContainer.setAttribute('data-automation-label', 'D');
            gradeContainer.style.backgroundColor = "yellow";
        }
    });

    let headerRow = targetRow.previousElementSibling;
    while (headerRow && !headerRow.innerText.includes("Satisfied")) {
        headerRow = headerRow.previousElementSibling;
    }

    if (headerRow) {
        const walker = document.createTreeWalker(headerRow, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim() === "Satisfied") {
                node.textContent = "In Progress";
                node.parentElement.style.color = "orange";
                node.parentElement.style.fontWeight = "bold";
            }
        }
        console.log("Success: CSC 4103 grade set to 'D' and Section Status set to 'In Progress'.");
    } else {
        console.error("Could not find the 'Satisfied' header row above CSC 4103.");
    }
})();
