(function() {
    const rows = document.querySelectorAll('tr, [role="row"]');
    let removed = 0;

    rows.forEach(row => {
        if (row.innerText.includes("CSC 3304")) {
            row.remove();
            removed++;
        }
    });

    console.log(`Removed ${removed} row(s) containing CSC 3304.`);

    // Find the 3000 Level Courses requirement header row
    const allRows = document.querySelectorAll('tr, [role="row"]');
    let headerRow = null;
    allRows.forEach(row => {
        if (row.innerText.includes("3000 Level Courses") && row.innerText.includes("Cybersecurity")) {
            headerRow = row;
        }
    });

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
        console.log("Success: '3000 Level Courses' status set to 'In Progress'.");
    } else {
        console.error("Could not find the 'LSUAM Computer Science, BS with Cybersecurity 3000 Level Courses' header row.");
    }
})();
