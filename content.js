// content.js

function clickExcelButton() {
  const btn = document.querySelector('[data-automation-id="excelIconButton"]');
  if (btn) {
    btn.click();
  } else {
    console.warn('Excel button not found on page');
  }
}

// Listen for a trigger from the popup or background to click the button
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLICK_EXCEL') {
    clickExcelButton();
  }

  if (message.type === 'EXCEL_DATA') {
    console.log('Got parsed Excel data:', message.data);
    // TODO: use message.data however you need (render table, process rows, etc.)
  }
});
