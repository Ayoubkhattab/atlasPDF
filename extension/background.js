// AtlasPDF Chrome Extension - Background Service Worker

const ATLASPDF_URL = 'https://atlaspdf.mis-pts.org/en';

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    // Create main context menu item
    chrome.contextMenus.create({
        id: 'atlaspdf-open',
        title: 'Open with AtlasPDF',
        contexts: ['link', 'page']
    });

    // Create submenu for specific tools
    chrome.contextMenus.create({
        id: 'atlaspdf-merge',
        parentId: 'atlaspdf-open',
        title: 'Merge PDFs',
        contexts: ['link', 'page']
    });

    chrome.contextMenus.create({
        id: 'atlaspdf-compress',
        parentId: 'atlaspdf-open',
        title: 'Compress PDF',
        contexts: ['link', 'page']
    });

    chrome.contextMenus.create({
        id: 'atlaspdf-convert',
        parentId: 'atlaspdf-open',
        title: 'Convert to PDF',
        contexts: ['link', 'page']
    });

    chrome.contextMenus.create({
        id: 'atlaspdf-all-tools',
        parentId: 'atlaspdf-open',
        title: 'All Tools →',
        contexts: ['link', 'page']
    });

    console.log('AtlasPDF context menus created');
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    let url = ATLASPDF_URL;

    switch (info.menuItemId) {
        case 'atlaspdf-merge':
            url = `${ATLASPDF_URL}/tools/merge-pdf`;
            break;
        case 'atlaspdf-compress':
            url = `${ATLASPDF_URL}/tools/compress-pdf`;
            break;
        case 'atlaspdf-convert':
            url = `${ATLASPDF_URL}/tools/jpg-to-pdf`;
            break;
        case 'atlaspdf-all-tools':
        case 'atlaspdf-open':
            url = ATLASPDF_URL;
            break;
        default:
            url = ATLASPDF_URL;
    }

    // Open AtlasPDF in a new tab
    chrome.tabs.create({ url: url });
});

// Log when service worker starts
console.log('AtlasPDF background service worker started');
