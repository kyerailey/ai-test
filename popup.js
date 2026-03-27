let requirementDB = null;
let lastScrapedData = null; // NEW: Global storage for the PDF function

async function initializePopup() {
  try {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('versionLabel').innerText = `Version: ${manifest.version}`;

    const response = await fetch(chrome.runtime.getURL('class_requirements.json'));
    requirementDB = await response.json();

    const yearDropdown = document.getElementById('yearDropdown');
    const major = "Computer Science";
    const availableYears = Object.keys(requirementDB[major]);

    yearDropdown.innerHTML = '<option value="" disabled selected>Select Catalog Year</option>';

    availableYears.forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = `Catalog Year: ${year}`;
      yearDropdown.appendChild(option);
    });
  } catch (error) {
    console.error("Error loading JSON:", error);
    document.getElementById('statusMessage').innerText = "Error: JSON file not found.";
  }
}

document.getElementById('yearDropdown').addEventListener('change', (e) => {
    document.getElementById('scrapeBtn').disabled = (e.target.value === "");
    document.getElementById('statusMessage').innerText = "Step 2: Click 'Analyze Audit'";
});

document.getElementById('resizeToggle').addEventListener('click', () => {
  document.body.classList.toggle('large-mode');
});

document.getElementById('scrapeBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const selectedYear = document.getElementById('yearDropdown').value;
  const resultsContainer = document.getElementById('resultsContainer');

  resultsContainer.innerHTML = '<div style="text-align:center; padding:20px;">Analyzing Audit...</div>';

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const legend = document.querySelector('[data-automation-id="fieldSetLegendLabel"]');
      const legendText = legend ? legend.innerText : "";
      const concentrationMatch = legendText.match(/concentration in (.*?) - BS/);
      const detectedConcentration = concentrationMatch ? concentrationMatch[1] : "General";

      const rows = document.querySelectorAll('tr, [role="row"]');
      let auditData = [];
      let masterCourseList = [];

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]')).map(c => c.innerText.trim());
        if (cells.length < 2) return;

        const rowText = row.innerText.toUpperCase();

        if ((rowText.includes("LSUAM") || rowText.includes("MAJOR GPA")) && !rowText.includes("GPA")) {
          auditData.push({
            name: cells[0],
            status: cells[1] || "",
            remainingText: cells[2] || "",
            classes: []
          });
        }

        const courseMatchIndex = cells.findIndex(c => /^[A-Z]{2,4}\s*\d{4}/.test(c.toUpperCase()));
        
        if (courseMatchIndex !== -1) {
          const rawCode = cells[courseMatchIndex].match(/^[A-Z]{2,4}\s*\d{4}/)[0];
          const code = rawCode.replace(/^([A-Z]+)(\d+)/, '$1 $2'); 
          
          const gradeMatch = cells.findLast((c, i) => {
            if (i === courseMatchIndex) return false;
            const cellText = c.toUpperCase().trim();
            return /^[A-DF][+-]?(\s?\(.*\))?$/.test(cellText) || 
                   ["IP", "CR", "P", "PASS", "IN PROGRESS"].some(s => cellText.includes(s));
          });

          if (gradeMatch) {
            masterCourseList.push({ code, grade: gradeMatch.toUpperCase() });
          }
        }
      });

      return { auditData, masterCourseList, detectedConcentration };
    }
  }, (injectionResults) => {
    if (!injectionResults || !injectionResults[0].result) return;

    const { auditData, masterCourseList, detectedConcentration } = injectionResults[0].result;
    
    // NEW: Save data and enable the Export button
    lastScrapedData = { auditData, masterCourseList, detectedConcentration };
    document.getElementById('printBtn').disabled = false;

    const statusMsg = document.getElementById('statusMessage');
    statusMsg.innerText = `Detected: ${detectedConcentration}`;
    statusMsg.style.color = "#28a745";
    statusMsg.style.fontWeight = "bold";

    const yearData = requirementDB["Computer Science"][selectedYear];
    const normalize = str => str.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    const normalizedDetected = normalize(detectedConcentration);
    const concentrationKeys = Object.keys(yearData).filter(k => k !== 'metadata');
    const concentrationKey = concentrationKeys.find(k => normalize(k) === normalizedDetected)
      || concentrationKeys.find(k => normalize(k).includes(normalizedDetected) || normalizedDetected.includes(normalize(k)))
      || concentrationKeys[0];

    if (!concentrationKey) {
      statusMsg.innerText = `Error: No matching concentration found`;
      statusMsg.style.color = "#d9534f";
      return;
    }

    const activeRules = yearData[concentrationKey];
    const alternatives = yearData.metadata.alternative_classes;
    resultsContainer.innerHTML = '';

    const sortedAuditData = [...auditData].sort((a, b) => {
      const getScore = (s) => {
        const low = s.toLowerCase();
        if (low.includes("not satisfied")) return 1;
        if (low.includes("in progress")) return 2;
        if (low.includes("satisfied")) return 3;
        return 4;
      };
      return getScore(a.status) - getScore(b.status);
    });

    const renderItem = (item) => {
      const jsonReq = activeRules.requirements.find(req =>
        item.name.toLowerCase().includes(req.category.toLowerCase())
      );

      const remainingNum = (item.remainingText.match(/\d+/) || [0])[0];
      const isCredits = item.remainingText.toLowerCase().includes("credit");
      const remainingLabel = isCredits ? `${remainingNum} credits remaining` : `${remainingNum} class(es) remaining`;
      let classesLeftToTake = [];
      let gradeErrors = [];

      const isGenericElective = ["area elective", "group a", "group b", "csc elective"].some(el =>
        item.name.toLowerCase().includes(el)
      );

      if (jsonReq && !isGenericElective) {
        jsonReq.courses.forEach(courseObj => {
          const baseCode = typeof courseObj === 'object' ? courseObj.code : courseObj;
          const minGrade = typeof courseObj === 'object' ? courseObj.min_grade : null;
          const validCodes = [baseCode, ...(alternatives[baseCode] || [])];

          if (baseCode.endsWith("+")) return; 
          const taken = masterCourseList.find(c => validCodes.includes(c.code));

          if (!taken) {
            classesLeftToTake.push(baseCode);
          } else if (minGrade === "C" && !taken.grade.includes("IP")) {
            if (["F", "D+", "D", "D-"].some(dg => taken.grade.startsWith(dg))) {
              gradeErrors.push(`${taken.code} (${taken.grade})`);
            }
          }
        });
      }

      const statusColor = (item.status.toLowerCase().includes("satisfied") && !item.status.toLowerCase().includes("not")) ? "#5cb85c" :
                          (item.status.toLowerCase().includes("in progress") ? "#f0ad4e" : "#d9534f");

      const section = document.createElement('div');
      section.style.cssText = `margin-bottom: 12px; padding: 12px; border-left: 6px solid ${statusColor}; background: white; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);`;

      const remainingHtml = (remainingNum > 0) ? `<div style="color: #d9534f; font-size: 11px; font-weight: bold; margin-top: 4px;">${remainingLabel}</div>` : '';
      const classesHtml = (classesLeftToTake.length > 0) ? `<div style="color: #d9534f; font-size: 11px; margin-top: 4px;"><strong>Left to take:</strong> ${classesLeftToTake.join(', ')}</div>` : '';
      const errorHtml = gradeErrors.map(err => `<div style="color: #d9534f; font-size: 11px; margin-top: 4px; font-weight: bold;">Grade Error: ${err}</div>`).join('');

      section.innerHTML = `
        <div style="font-weight: bold; font-size: 13px;">${item.name}</div>
        <div style="font-size: 11px; color: #777;">STATUS: ${item.status.toUpperCase()}</div>
        ${remainingHtml}${classesHtml}${errorHtml}
      `;
      resultsContainer.appendChild(section);
    };

    const renderSection = (items, sectionTitle) => {
      if (items.length === 0) return;
      const header = document.createElement('div');
      header.style.cssText = 'text-align: center; font-weight: bold; font-size: 13px; color: #555; margin: 16px 0 8px; letter-spacing: 1px; border-bottom: 1px solid #ddd; padding-bottom: 6px;';
      header.textContent = `- ${sectionTitle} -`;
      resultsContainer.appendChild(header);
      items.forEach(renderItem);
    };

    const csItems = sortedAuditData.filter(item => item.name.toLowerCase().includes(detectedConcentration.toLowerCase()) || item.name.toLowerCase().includes('elective'));
    const genEdItems = sortedAuditData.filter(item => !item.name.toLowerCase().includes(detectedConcentration.toLowerCase()) && !item.name.toLowerCase().includes('elective'));

    renderSection(csItems, "Computer Science Classes");
    renderSection(genEdItems, "General Elective Classes");
  });
});

// NEW: PDF GENERATION FUNCTION
async function generatePDF() {
  if (!lastScrapedData) return;
  const statusMsg = document.getElementById('statusMessage');
  statusMsg.innerText = "Generating PDF...";

  try {
    const { PDFDocument, rgb } = PDFLib;
    
    // 1. Fetch template from assets folder
    const pdfUrl = chrome.runtime.getURL('assets/Senior_Checkout_Blank_26.pdf');
    const existingBytes = await fetch(pdfUrl).then(res => res.arrayBuffer());
    
    // 2. Load the PDF
    const pdfDoc = await PDFDocument.load(existingBytes);
    const page = pdfDoc.getPages()[0];

    // 3. Printing coordinates (Calibration needed for LSU form)
    let y = 580; 
    const xCourse = 105;
    const xGrade = 445;
    const lineHeight = 17.5;

    // 4. Draw scraped course data
    lastScrapedData.masterCourseList.forEach(course => {
      if (y > 50) {
        page.drawText(course.code, { x: xCourse, y: y, size: 10 });
        page.drawText(course.grade, { x: xGrade, y: y, size: 10 });
        y -= lineHeight;
      }
    });

    // 5. Finalize and Download
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Senior_Checkout_${lastScrapedData.detectedConcentration.replace(/\s+/g, '_')}.pdf`;
    link.click();
    
    statusMsg.innerText = "PDF Downloaded!";
  } catch (err) {
    console.error("PDF Export Error:", err);
    statusMsg.innerText = "Error exporting PDF.";
  }
}

// NEW: Event Listener for Print Button
document.getElementById('printBtn').addEventListener('click', generatePDF);

initializePopup();