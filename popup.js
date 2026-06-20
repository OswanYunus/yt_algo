// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    // Initialize tab-specific content
    if (tabName === 'preferences') {
      initPreferencesTab();
    } else if (tabName === 'blacklist') {
      initBlacklistTab();
    }
  });
});

// AUTOPLAY TAB
const toggleSeen = document.getElementById('toggle-seen');
const toggleNew  = document.getElementById('toggle-new');
const cardSeen   = document.getElementById('card-seen');
const cardNew    = document.getElementById('card-new');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const watchCount = document.getElementById('watch-count');
const clearBtn   = document.getElementById('clear-btn');
const nextCard   = document.getElementById('next-card');
const nextEmpty  = document.getElementById('next-empty');
const nextThumb  = document.getElementById('next-thumb');
const nextTitle  = document.getElementById('next-title');
const nextMeta   = document.getElementById('next-meta');
const nextReason = document.getElementById('next-reason');

let nextVideoUrl = '';

chrome.storage.local.get(['mode', 'watchedVideos', 'nextVideoPreview'], (data) => {
  const mode = data.mode || 'off';
  const watched = data.watchedVideos || {};

  if (mode === 'seen') toggleSeen.checked = true;
  if (mode === 'new') toggleNew.checked = true;

  updateUI(mode);
  watchCount.textContent = Object.keys(watched).length;
  updateNextPreview(data.nextVideoPreview);
});

setInterval(() => {
  chrome.storage.local.get(['watchedVideos', 'nextVideoPreview'], (data) => {
    const watched = data.watchedVideos || {};
    watchCount.textContent = Object.keys(watched).length;
    updateNextPreview(data.nextVideoPreview);
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
  chrome.storage.local.set({ watchedVideos: {}, nextVideoPreview: null }, () => {
    watchCount.textContent = '0';
    updateNextPreview(null);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_HISTORY' });
    });
  });
});

nextCard.addEventListener('click', () => {
  if (!nextVideoUrl) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: nextVideoUrl });
  });
});

function saveMode(mode) {
  const update = { mode };
  if (mode === 'off') update.nextVideoPreview = null;

  chrome.storage.local.set(update, () => {
    updateUI(mode);
    if (mode === 'off') updateNextPreview(null);
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
    statusText.textContent = 'Both off - YouTube controls autoplay';
  }
}

function updateNextPreview(preview) {
  if (!preview || !preview.id) {
    nextVideoUrl = '';
    nextCard.hidden = true;
    nextEmpty.hidden = false;
    return;
  }

  nextVideoUrl = preview.url || `https://www.youtube.com/watch?v=${preview.id}`;
  nextCard.hidden = false;
  nextEmpty.hidden = true;
  nextThumb.src = preview.thumbnail || `https://i.ytimg.com/vi/${preview.id}/hqdefault.jpg`;
  nextTitle.textContent = preview.title || 'Untitled video';

  const meta = [preview.modeLabel, preview.source, preview.score ? `score ${preview.score}` : '']
    .filter(Boolean)
    .join(' - ');
  nextMeta.textContent = meta || 'selected next';
  nextReason.textContent = preview.reason || 'Selected because it matched the current video.';
}

// PREFERENCES TAB
function initPreferencesTab() {
  getPreferences((prefs) => {
    const container = document.getElementById('preferences-container');
    if (container.innerHTML) return; // Already initialized
    
    let html = '';
    
    for (const [categoryKey, category] of Object.entries(GENRE_PREFERENCES)) {
      html += `<div class="category-header">${category.icon} ${category.name}</div>`;
      
      if (category.subcategories) {
        // Movies category
        for (const [subKey, subcategory] of Object.entries(category.subcategories)) {
          html += `<div class="subcategory-header">${subcategory.name}</div>`;
          html += `<div class="genre-grid">`;
          subcategory.genres.forEach(genre => {
            const genreKey = formatGenreKey(categoryKey, subKey, genre);
            const isChecked = prefs.selectedGenres[genreKey] ? 'checked' : '';
            html += `
              <div class="genre-item">
                <input type="checkbox" class="genre-checkbox" value="${genreKey}" ${isChecked} />
                <label>${genre}</label>
              </div>
            `;
          });
          html += `</div>`;
        }
      } else {
        // Regular categories
        html += `<div class="genre-grid">`;
        category.genres.forEach(genre => {
          const genreKey = formatGenreKey(categoryKey, null, genre);
          const isChecked = prefs.selectedGenres[genreKey] ? 'checked' : '';
          html += `
            <div class="genre-item">
              <input type="checkbox" class="genre-checkbox" value="${genreKey}" ${isChecked} />
              <label>${genre}</label>
            </div>
          `;
        });
        html += `</div>`;
      }
    }
    
    container.innerHTML = html;
  });
  
  // Set up save button
  document.getElementById('save-prefs-btn').onclick = savePrefences;
}

function savePrefences() {
  const selectedGenres = {};
  document.querySelectorAll('.genre-checkbox:checked').forEach(checkbox => {
    selectedGenres[checkbox.value] = true;
  });
  
  if (Object.keys(selectedGenres).length === 0) {
    showNotification('pref-notification', 'Please select at least one genre', true);
    return;
  }
  
  saveGenrePreferences(selectedGenres, () => {
    showNotification('pref-notification', 'Preferences saved! Please refresh your YouTube page.');
    setTimeout(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'PREFERENCES_CHANGED' });
          chrome.tabs.reload(tabs[0].id);
        }
      });
    }, 1500);
  });
}

// BLACKLIST TAB
function initBlacklistTab() {
  getPreferences((prefs) => {
    renderBlacklist(prefs.blacklistedChannels);
  });
  
  // Set up add button
  document.getElementById('add-channel-btn').onclick = addChannel;
  document.getElementById('channel-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addChannel();
  });
  
  // Set up save button
  document.getElementById('save-blacklist-btn').onclick = saveBlacklist;
}

function renderBlacklist(channels) {
  const listContainer = document.getElementById('channel-list');
  
  if (channels.length === 0) {
    listContainer.innerHTML = '<p style="font-size: 11px; color: #888; text-align: center; padding: 20px;">No channels blacklisted yet.</p>';
    return;
  }
  
  let html = '';
  channels.forEach((channel, index) => {
    html += `
      <div class="channel-item">
        <span>${channel}</span>
        <button class="channel-remove" onclick="removeChannel(${index})">Remove</button>
      </div>
    `;
  });
  listContainer.innerHTML = html;
}

function addChannel() {
  const input = document.getElementById('channel-input');
  const channelName = input.value.trim();
  
  if (!channelName) {
    showNotification('blacklist-notification', 'Please enter a channel name or ID', true);
    return;
  }
  
  getPreferences((prefs) => {
    if (prefs.blacklistedChannels.includes(channelName)) {
      showNotification('blacklist-notification', 'This channel is already blacklisted', true);
      return;
    }
    
    prefs.blacklistedChannels.push(channelName);
    saveBlacklistedChannels(prefs.blacklistedChannels, () => {
      input.value = '';
      renderBlacklist(prefs.blacklistedChannels);
      showNotification('blacklist-notification', 'Channel added to blacklist');
    });
  });
}

function removeChannel(index) {
  getPreferences((prefs) => {
    prefs.blacklistedChannels.splice(index, 1);
    saveBlacklistedChannels(prefs.blacklistedChannels, () => {
      renderBlacklist(prefs.blacklistedChannels);
    });
  });
}

function saveBlacklist() {
  showNotification('blacklist-notification', 'Blacklist saved! Please refresh your YouTube page.');
  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'BLACKLIST_CHANGED' });
        chrome.tabs.reload(tabs[0].id);
      }
    });
  }, 1500);
}

function showNotification(elementId, message, isError = false) {
  const notification = document.getElementById(elementId);
  notification.textContent = message;
  notification.classList.add('show');
  
  if (!isError) {
    setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }
}