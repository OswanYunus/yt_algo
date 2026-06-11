const toggleSeen = document.getElementById('toggle-seen');
const toggleNew  = document.getElementById('toggle-new');
const cardSeen   = document.getElementById('card-seen');
const cardNew    = document.getElementById('card-new');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const watchCount = document.getElementById('watch-count');
const clearBtn   = document.getElementById('clear-btn');


chrome.storage.local.get(['mode', 'watchedVideos'], (data) => {
  const mode    = data.mode || 'off';
  const watched = data.watchedVideos || {};

  if (mode === 'seen') toggleSeen.checked = true;
  if (mode === 'new')  toggleNew.checked  = true;

  updateUI(mode);
  watchCount.textContent = Object.keys(watched).length;
});


setInterval(() => {
  chrome.storage.local.get(['watchedVideos'], (data) => {
    const watched = data.watchedVideos || {};
    watchCount.textContent = Object.keys(watched).length;
  });
}, 1000);


toggleSeen.addEventListener('change', () => {
  if (toggleSeen.checked) toggleNew.checked = false;
  saveMode(toggleSeen.checked ? 'seen' : 'off');
});


toggleNew.addEventListener('change', () => {
  if (toggleNew.checked) toggleSeen.checked = false;
  saveMode(toggleNew.checked ? 'new' : 'off');
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ watchedVideos: {} }, () => {
    watchCount.textContent = '0';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_HISTORY' });
    });
  });
});

function saveMode(mode) {
  chrome.storage.local.set({ mode }, () => {
    updateUI(mode);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'MODE_CHANGE', mode });
    });
  });
}

function updateUI(mode) {
  cardSeen.classList.remove('active-seen');
  cardNew.classList.remove('active-new');

  if (mode === 'seen') {
    cardSeen.classList.add('active-seen');
    statusDot.style.background = '#3d7ef5';
    statusText.textContent = 'Playing related videos from your history';
  } else if (mode === 'new') {
    cardNew.classList.add('active-new');
    statusDot.style.background = '#2ba640';
    statusText.textContent = "Playing fresh related videos you haven't seen";
  } else {
    statusDot.style.background = '#444';
    statusText.textContent = 'Both off — YouTube controls autoplay';
  }
}