// content.js

function scrapeData() {
    console.log("Starting scrape...");
    
    // NOTE: You will need to inspect the Workday page to find 
    // the exact CSS classes for course names and grades.
    const courseSelectors = document.querySelectorAll('.wd-course-class-name'); 
    
    let coursesTaken = [];
    
    courseSelectors.forEach(element => {
        coursesTaken.push(element.innerText.trim());
    });

    console.log("Courses Found:", coursesTaken);
    return coursesTaken;
}

// Run the scrape after a short delay to let the page load
setTimeout(scrapeData, 3000);