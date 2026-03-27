// background.js

importScripts('xlsx.full.min.js');

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!downloadItem.url || !isExcel(downloadItem)) return;

  chrome.downloads.cancel(downloadItem.id, async () => {
    try {
      const response = await fetch(downloadItem.url);
      const arrayBuffer = await response.arrayBuffer();

      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet);

      chrome.storage.local.set({ parsedData: data }, () => {
        console.log('Excel parsed, rows:', data.length);
      });

      chrome.downloads.erase({ id: downloadItem.id });

      // Send parsed data back to the active tab's content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'EXCEL_DATA', data: data });
        }
      });

    } catch (err) {
      console.error('Failed to fetch/parse Excel:', err);
    }
  });
});

function isExcel(item) {
  return (
    item.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    item.url.includes('.xlsx') ||
    (item.filename && item.filename.endsWith('.xlsx'))
  );
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'TRIGGER_EXCEL') {
    console.log('Excel trigger received from tab:', sender.tab?.id);
  }
});
