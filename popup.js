let requirementDB = null;
let lastScrapedData = null;

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
      // --- Detect concentration ---
      const legend = document.querySelector('[data-automation-id="fieldSetLegendLabel"]');
      const legendText = legend ? legend.innerText : "";
      const concentrationMatch = legendText.match(/concentration in (.*?) - BS/);
      const detectedConcentration = concentrationMatch ? concentrationMatch[1] : "General";

      // --- Scrape student name and UID from Workday profile button ---
      let studentName = "";
      let studentUID = "";

      const profileBtn = document.querySelector('[data-automation-id="Current_User"]');
      if (profileBtn) {
      const ariaLabel = profileBtn.getAttribute('aria-label') || "";
      const match = ariaLabel.match(/^Profile\s+(.+?)\s+\((\d+)\)$/);
      if (match) {
        studentName = match[1];
        studentUID  = match[2];
  }
}

      // --- Scrape expected grad date ---
      let gradDate = "";
      const bodyText = document.body.innerText;
      const gradMatch = bodyText.match(/(?:anticipated|expected|graduation)[^0-9]*([0-1][0-9]\/[0-9]{4})/i);
      if (gradMatch) gradDate = gradMatch[1];

      // --- Scrape audit rows ---
      const rows = document.querySelectorAll('tr, [role="row"]');
      let auditData = [];
      let masterCourseList = [];

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]')).map(c => c.innerText.trim());
        if (cells.length < 2) return;

        const rowText = row.innerText.toUpperCase();

        // Capture section headers
        if ((rowText.includes("LSUAM") || rowText.includes("MAJOR GPA")) && !rowText.includes("GPA")) {
          auditData.push({
            name: cells[0],
            status: cells[1] || "",
            remainingText: cells[2] || "",
            classes: []
          });
        }

        // Identify course rows
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

          // FIX: Always push the course. If no grade is detected, default to "IP"
          // so that in-progress courses aren't mistakenly treated as not taken.
          masterCourseList.push({ code, grade: gradeMatch ? gradeMatch.toUpperCase() : "IP" });
        }
      });

      return { auditData, masterCourseList, detectedConcentration, studentName, studentUID, gradDate };
    }
  }, (injectionResults) => {
    if (!injectionResults || !injectionResults[0].result) return;

    const { auditData, masterCourseList, detectedConcentration, studentName, studentUID, gradDate } =
      injectionResults[0].result;

    // FIXED: use consistent variable name
    lastScrapedData = { auditData, masterCourseList, detectedConcentration, studentName, studentUID, gradDate };
    document.getElementById('pdfBtn').disabled = false;

    const statusMsg = document.getElementById('statusMessage');
    const nameDisplay = studentName ? ` | ${studentName}` : '';
    statusMsg.innerText = `Detected: ${detectedConcentration}${nameDisplay}`;
    statusMsg.style.color = "#28a745";
    statusMsg.style.fontWeight = "bold";

    const yearData = requirementDB["Computer Science"][document.getElementById('yearDropdown').value];
    const normalize = str => str.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    const normalizedDetected = normalize(detectedConcentration);
    const concentrationKeys = Object.keys(yearData).filter(k => k !== 'metadata');
    const concentrationKey = concentrationKeys.find(k => normalize(k) === normalizedDetected)
      || concentrationKeys.find(k => normalize(k).includes(normalizedDetected) || normalizedDetected.includes(normalize(k)))
      || concentrationKeys[0];

    if (!concentrationKey) {
      statusMsg.innerText = `Error: No matching concentration found for "${detectedConcentration}"`;
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

      const statusColor = (item.status.toLowerCase().includes("satisfied") && !item.status.toLowerCase().includes("not"))
        ? "#5cb85c"
        : (item.status.toLowerCase().includes("in progress") ? "#f0ad4e" : "#d9534f");

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

    const csItems = sortedAuditData.filter(item =>
      item.name.toLowerCase().includes(detectedConcentration.toLowerCase()) ||
      item.name.toLowerCase().includes('elective')
    );
    const genEdItems = sortedAuditData.filter(item =>
      !item.name.toLowerCase().includes(detectedConcentration.toLowerCase()) &&
      !item.name.toLowerCase().includes('elective')
    );

    renderSection(csItems, "Computer Science Classes");
    renderSection(genEdItems, "General Elective Classes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATION
// Fills the blank Senior_Checkout.pdf template with:
//   Page 1: Student NAME, UID, Grad Date, Major (CSC), Concentration abbr
//   Page 2: Remaining CS-major courses only — Hours, Course code, "Y" if C required,
//            and Total Hours in the summary box
// ─────────────────────────────────────────────────────────────────────────────
async function generatePDF(gradDate) {
  if (!lastScrapedData) return;

  const statusMsg = document.getElementById('statusMessage');
  statusMsg.innerText = "Generating PDF...";
  statusMsg.style.color = "#0275d8";

  try {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;

    const pdfUrl = chrome.runtime.getURL('assets/Senior_Checkout.pdf');
    const existingPdfBytes = await fetch(pdfUrl).then(res => res.arrayBuffer());
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { detectedConcentration, studentName, studentUID, auditData } = lastScrapedData;
    const selectedYear = document.getElementById('yearDropdown').value;

    // ── Resolve concentration key and rules ──────────────────────────────────
    const yearData = requirementDB["Computer Science"][selectedYear];
    const normalizeText = (str) => (str || "").toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    const normalizedDetected = normalizeText(detectedConcentration);
    const concentrationKeys = Object.keys(yearData).filter(k => k !== 'metadata');
    const concentrationKey = concentrationKeys.find(k => normalizeText(k) === normalizedDetected)
      || concentrationKeys.find(k =>
          normalizeText(k).includes(normalizedDetected) || normalizedDetected.includes(normalizeText(k))
        )
      || concentrationKeys[0];

    const activeRules = yearData[concentrationKey];
    const alternatives = yearData.metadata.alternative_classes;
    const masterCourseList = lastScrapedData.masterCourseList;

    // ── Build remaining CS-only course list ──────────────────────────────────
    // For fixed requirements, list explicit missing courses.
    // For flexible buckets (Area/Group/CSC electives), use Workday remaining
    // counts and add placeholder rows instead of listing every possible option.
    const remainingCourses = []; // { code, hours, requiresC }

    const parseRemainingUnits = (remainingText = "") => {
      const amount = Number((remainingText.match(/\d+/) || [0])[0]) || 0;
      const isCredits = remainingText.toLowerCase().includes("credit");
      if (amount <= 0) return 0;
      return isCredits ? Math.ceil(amount / 3) : amount;
    };

    const isFlexibleRequirement = (req) => {
      const category = normalizeText(req.category);
      if (category.includes("elective") || category.includes("group")) return true;

      return req.courses.some((courseObj) => {
        const code = typeof courseObj === "object" ? courseObj.code : courseObj;
        return code.endsWith("+") || code.startsWith("GROUP_");
      });
    };

    const findAuditItemForRequirement = (reqCategory) => {
      if (!Array.isArray(auditData)) return null;

      const reqNorm = normalizeText(reqCategory);
      const aliases = [reqNorm];

      if (reqNorm.includes("csc elective")) aliases.push("additional csc elective");
      if (reqNorm.includes("area elective")) aliases.push("area elective");
      if (reqNorm.includes("group a or group b")) aliases.push("group a or b");

      return auditData.find((item) => {
        const nameNorm = normalizeText(item.name);
        return aliases.some((alias) => nameNorm.includes(alias));
      }) || null;
    };

    const toPlaceholderCode = (reqCategory) => {
      const category = reqCategory.toUpperCase();
      if (category.includes("AREA ELECTIVE")) return `${getConcentrationAbbr(detectedConcentration)} AREA ELECTIVE`;
      if (category.includes("CSC ELECTIVE")) return "CSC ELECTIVE";
      if (category.includes("GROUP A OR GROUP B")) return "GROUP A/B ELECTIVE";
      if (category.includes("GROUP A")) return "GROUP A ELECTIVE";
      return reqCategory.toUpperCase();
    };

    activeRules.requirements.forEach(req => {
      if (isFlexibleRequirement(req)) {
        const auditItem = findAuditItemForRequirement(req.category);
        const slots = parseRemainingUnits(auditItem?.remainingText || "");

        for (let i = 0; i < slots; i++) {
          remainingCourses.push({
            code: toPlaceholderCode(req.category),
            hours: 3,
            requiresC: false,
            isPlaceholder: true,
          });
        }
        return;
      }

      req.courses.forEach(courseObj => {
        const baseCode  = typeof courseObj === 'object' ? courseObj.code       : courseObj;
        const minGrade  = typeof courseObj === 'object' ? (courseObj.min_grade || null) : null;
        const creditHrs = typeof courseObj === 'object' ? (courseObj.credits   || 3)    : 3;

        if (baseCode.endsWith("+")) return; // skip elective placeholders

        const validCodes = [baseCode, ...(alternatives[baseCode] || [])];
        const taken = masterCourseList.find(c => validCodes.includes(c.code));

        let isRemaining = false;
        if (!taken) {
          isRemaining = true;
        } else if (taken.grade.includes("IP")) {
          // Course is in progress — do not list as remaining
          isRemaining = false;
        } else if (minGrade === "C") {
          // Retake needed if grade is below C-
          if (["F", "D+", "D", "D-"].some(dg => taken.grade.startsWith(dg))) {
            isRemaining = true;
          }
        }

        if (isRemaining && !remainingCourses.find(c => c.code === baseCode && !c.isPlaceholder)) {
          remainingCourses.push({ code: baseCode, hours: creditHrs, requiresC: minGrade === "C" });
        }
      });
    });

    const concentrationAbbr = getConcentrationAbbr(detectedConcentration);
    const totalHours = remainingCourses.reduce((sum, c) => sum + (c.hours || 3), 0);
    const PAGE_H = 792;
    const BLACK  = rgb(0, 0, 0);
    const FS     = 10; // standard font size

    // ── PAGE 1 ───────────────────────────────────────────────────────────────
    const page1 = pdfDoc.getPages()[0];

    // NAME (label ends ~x=110, row top=90.8 in pdfplumber)
    page1.drawText(studentName || "________________", {
      x: 112, y: PAGE_H - 102,
      size: FS, font: helveticaBold, color: BLACK,
    });

    // UID (label ends ~x=332, same row)
    page1.drawText(studentUID ? `00${studentUID}`.slice(-8) : "________", {
      x: 336, y: PAGE_H - 102,
      size: FS, font: helveticaBold, color: BLACK,
    });

    // Degree info table — single data row.
    // From the Abshire filled PDF visual, the data row sits just below the
    // "Grad Date / Major / Concentration / Minor / Minor / Minor" header row.
    // pdfplumber measured the header at top≈268.9, so the data row ≈ 291.
    const DI_Y = PAGE_H - 302; // degree info row baseline

    // Grad Date
    page1.drawText(gradDate || "12/2026", {
      x: 87, y: DI_Y, size: FS, font: helvetica, color: BLACK,
    });

    // Major — always CSC
    page1.drawText("CSC", {
      x: 180, y: DI_Y, size: FS, font: helvetica, color: BLACK,
    });

    // Concentration abbreviation
    page1.drawText(concentrationAbbr, {
      x: 245, y: DI_Y, size: FS, font: helvetica, color: BLACK,
    });

    // ── PAGE 2: REMAINING COURSEWORK table ───────────────────────────────────
    //
    // Column X positions (measured from blank template):
    //   Hours      x = 83
    //   Requirement x = 150
    //   C Grade1   x = 266   ← place "Y" here if min_grade === "C"
    //   MJ/MN2     x = 319   (leave blank)
    //   Comment    x = 420   (leave blank)
    //
    // Row Y positions (pdf-lib = 792 - pdfplumber_top):
    //   MAJOR: label at pdfplumber top=132.5  → pdf-lib y=659.5  (don't overwrite)
    //   First data row starts at pdf-lib y=646
    //   Row spacing = 14.5 pt
    //   Up to 14 rows fit before the MINOR: section
    //
    // Total Hours box:
    //   pdfplumber top≈542.9  → pdf-lib y=249

    const page2 = pdfDoc.getPages()[1];

    const ROW_START_Y = 630;
    const ROW_SPACING = 16;
    const MAX_ROWS    = 14;

    remainingCourses.slice(0, MAX_ROWS).forEach((course, i) => {
      const rowY = ROW_START_Y - (i * ROW_SPACING);

      // Hours
      page2.drawText(String(course.hours || 3), {
        x: 83, y: rowY, size: FS, font: helvetica, color: BLACK,
      });

      // Course code
      page2.drawText(course.code, {
        x: 150, y: rowY, size: FS, font: helvetica, color: BLACK,
      });

      // "Y" if a C or better is required
      if (course.requiresC) {
        page2.drawText("Y", {
          x: 266, y: rowY, size: FS, font: helveticaBold, color: BLACK,
        });
      }
    });

    // Total hours remaining box
    page2.drawText(String(totalHours), {
      x: 88, y: 249,
      size: 11, font: helveticaBold, color: BLACK,
    });

    // ── Save & download ──────────────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const link     = document.createElement('a');
    link.href      = URL.createObjectURL(blob);

    const safeName = (studentName || "Student")
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '_');
    link.download = `${safeName} Senior Checkout.pdf`;
    link.click();

    statusMsg.innerText = "PDF Generated!";
    statusMsg.style.color = "#28a745";

  } catch (err) {
    console.error("PDF Generation Error:", err);
    statusMsg.innerText = "Error generating PDF. Check console.";
    statusMsg.style.color = "#d9534f";
  }
}

/**
 * Converts a full concentration name to its standard 2–3 letter abbreviation.
 * Add more entries here as new concentrations appear.
 */
function getConcentrationAbbr(fullName) {
  const map = {
    "cybersecurity":        "CYB",
    "software engineering": "SEG",
    "cloud computing and networking":     "CCN",
    "data science and analytics":         "DSA",
    "second discipline":  "SD",
  };
  const key = (fullName || "").toLowerCase().trim();
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  // Fallback: first 3 uppercase letters with no spaces
  return key.replace(/\s+/g, '').slice(0, 3).toUpperCase() || "CS";
}

document.getElementById('pdfBtn').addEventListener('click', () => {
  // Pre-fill with a smart default based on current month
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  let defaultDate = month >= 9 ? `05/${year + 1}` : month >= 3 ? `12/${year}` : `05/${year}`;
  document.getElementById('gradInput').value = defaultDate;
  document.getElementById('gradModal').classList.add('show');
});

document.getElementById('modalCancel').addEventListener('click', () => {
  document.getElementById('gradModal').classList.remove('show');
});

document.getElementById('modalConfirm').addEventListener('click', () => {
  const input = document.getElementById('gradInput').value.trim();
  // Validate MM/YYYY format
  if (!/^(0[1-9]|1[0-2])\/[0-9]{4}$/.test(input)) {
    document.getElementById('gradInput').style.border = '1px solid #d9534f';
    document.getElementById('gradInput').placeholder = 'Invalid! Use MM/YYYY';
    return;
  }
  document.getElementById('gradModal').classList.remove('show');
  generatePDF(input); // pass the date into generatePDF
});
initializePopup();