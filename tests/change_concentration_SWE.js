const el = document.querySelector('[data-automation-id="fieldSetLegendLabel"]');
const newText = el.textContent.replace('Cybersecurity', 'Software Engineering');
el.textContent = newText;
el.setAttribute('title', newText);
el.setAttribute('aria-label', newText);

const rows = document.querySelectorAll('tr, [role="row"]');
rows.forEach(row => {
    if (row.innerText.includes("LSUAM Computer Science, BS with Cybersecurity 4000 Level Courses")) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes("Cybersecurity 4000 Lower Level Courses")) {
                node.textContent = node.textContent.replace("Cybersecurity 4000 Level Courses", "Software Engineering 4000 Level Courses");
            }
        }
    }
});

console.log("Done: concentration and Lower Level Courses header updated to Software Engineering.");
