// ============================================================
//  YT Fix — content.js
// ============================================================

console.log('YT Fix: loaded');

let currentMode    = 'off';
let watchedVideos  = {};
let currentVideoId = null;
let hasIntercepted = false;

// ── Boot ─────────────────────────────────────────────────────
chrome.storage.local.get(['mode', 'watchedVideos'], (data) => {
  currentMode   = data.mode          || 'off';
  watchedVideos = data.watchedVideos || {};
  console.log(`YT Fix: mode=${currentMode}, tracked=${Object.keys(watchedVideos).length} videos`);
  init();
});

// ── Messages from popup ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'MODE_CHANGE') {
    currentMode = msg.mode;
    console.log('YT Fix: mode →', currentMode);
  }
  if (msg.type === 'CLEAR_HISTORY') {
    watchedVideos = {};
    console.log('YT Fix: history cleared');
  }
});

// ── Init ──────────────────────────────────────────────────────
function init() {
  checkPage();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkPage, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function checkPage() {
  const videoId = getVideoId();
  if (!videoId) return;
  if (videoId === currentVideoId) return;

  console.log('YT Fix: new video', videoId);
  currentVideoId = videoId;
  hasIntercepted = false;
  waitForVideo();
}

// ── Wait for <video> ──────────────────────────────────────────
function waitForVideo() {
  const poll = setInterval(() => {
    const video = document.querySelector('video');
    if (video && video.readyState >= 1) {
      clearInterval(poll);
      attachVideoListeners(video);
    }
  }, 500);
}

function attachVideoListeners(video) {
  let watchTime = 0;
  let countingInterval = null;
  let hasRecorded = false;

  const startCounting = () => {
    if (countingInterval) return;
    countingInterval = setInterval(() => {
      watchTime++;
      if (watchTime >= 30 && !hasRecorded) {
        hasRecorded = true;
        recordVideo(currentVideoId);
      }
    }, 1000);
  };

  const stopCounting = () => {
    clearInterval(countingInterval);
    countingInterval = null;
  };

  video.addEventListener('play',  startCounting);
  video.addEventListener('pause', stopCounting);
  if (!video.paused) startCounting();

  // Primary end detection
  video.addEventListener('ended', () => {
    stopCounting();
    console.log('YT Fix: ended event');
    if (currentMode !== 'off' && !hasIntercepted) {
      hasIntercepted = true;
      setTimeout(handleAutoplay, 1500);
    }
  });

  // Backup: near-end detection (catches cases where ended fires too late)
  video.addEventListener('timeupdate', () => {
    if (
      !hasIntercepted &&
      currentMode !== 'off' &&
      video.duration > 0 &&
      video.currentTime >= video.duration - 1.5 &&
      !video.paused
    ) {
      hasIntercepted = true;
      console.log('YT Fix: near-end via timeupdate');
      setTimeout(handleAutoplay, 1500);
    }
  });
}

// ── Record watched video ──────────────────────────────────────
function recordVideo(videoId) {
  chrome.storage.local.get(['watchedVideos'], (data) => {
    const all   = data.watchedVideos || {};
    const title = document.title.replace(' - YouTube', '').trim();
    const tags  = extractTags();

    all[videoId] = { title, tags, timestamp: Date.now() };
    watchedVideos = all;

    chrome.storage.local.set({ watchedVideos: all }, () => {
      console.log(`YT Fix: ✅ recorded "${title}" | tags: [${tags.join(', ')}] | total: ${Object.keys(all).length}`);
    });
  });
}

// ── Tags ──────────────────────────────────────────────────────
function extractTags() {
  const tags = [];
  tags.push(...titleToTags(document.title.toLowerCase()));

  document.querySelectorAll('yt-chip-cloud-chip-renderer, tp-yt-paper-chip').forEach(chip => {
    const t = chip.textContent.trim().toLowerCase();
    if (t) tags.push(t);
  });

  const channel = document.querySelector('#channel-name a, ytd-channel-name a');
  if (channel) tags.push(channel.textContent.trim().toLowerCase());

  return [...new Set(tags)];
}

function titleToTags(title) {
  const map = {
    music:       ['music','song','official audio','official video','lyrics','ft.','feat.','audio'],
    afrobeats:   ['afrobeats','afro','amapiano','afropop','wizkid','burna boy','rema','ruger','davido','don toliver','afroswing'],
    hiphop:      ['hip hop','hiphop','rap','drill','trap','freestyle','cypher','kendrick','drake'],
    rnb:         ['r&b','rnb','soul','neo soul'],
    indian:      ['bollywood','hindi','punjabi','tollywood','desi','bhangra','classical indian','tamil','telugu'],
    horror:      ['horror','scary','thriller','jump scare','haunted','creepy','ghost'],
    gaming:      ['gameplay',"let's play",'walkthrough','gaming','playthrough','speedrun','minecraft','fortnite','gta'],
    comedy:      ['funny','comedy','meme','prank','try not to laugh','fails','roast'],
    documentary: ['documentary','explained','history of','true story','real life','biography'],
    anime:       ['anime','manga','one piece','naruto','demon slayer','attack on titan'],
    politics:    ['politics','election','government','president','policy','news','breaking'],
    cartoon:     ['cartoon','animated','tom and jerry','looney tunes','animation','pixar'],
  };

  const found = [];
  for (const [genre, keywords] of Object.entries(map)) {
    if (keywords.some(k => title.includes(k))) found.push(genre);
  }
  return found;
}

// ── Autoplay interception ─────────────────────────────────────
function handleAutoplay() {
  if (currentMode === 'off') return;

  const candidates = getSidebarVideos();
  const currentTags = extractTags();

  console.log(`YT Fix: handleAutoplay | mode=${currentMode} | ${candidates.length} candidates | tags=${currentTags}`);
  candidates.forEach(v => {
    console.log(`  - "${v.title}" | seen=${!!watchedVideos[v.id]} | tags=[${v.tags}]`);
  });

  let chosen = null;

  if (currentMode === 'seen') {
    // Step 1: related AND watched — ideal
    chosen = candidates.find(v => isRelated(v.tags, currentTags) && watchedVideos[v.id]);

    // Step 2: any watched video from the sidebar — still correct behaviour
    if (!chosen) {
      chosen = candidates.find(v => watchedVideos[v.id]);
      if (chosen) console.log('YT Fix: fallback — watched but not tag-matched');
    }

    // Step 3: nothing watched in sidebar at all — STAY, do not autoplay
    if (!chosen) {
      console.log('YT Fix: no watched videos in sidebar — blocking autoplay, staying on page');
      blockYouTubeAutoplay();
      return;
    }

  } else if (currentMode === 'new') {
    // Step 1: related AND unseen — ideal
    chosen = candidates.find(v => isRelated(v.tags, currentTags) && !watchedVideos[v.id]);

    // Step 2: any unseen video — still unseen, just not tag-matched
    if (!chosen) {
      chosen = candidates.find(v => !watchedVideos[v.id]);
      if (chosen) console.log('YT Fix: fallback — unseen but not tag-matched');
    }

    // Step 3: everything in sidebar is already watched — block autoplay
    if (!chosen) {
      console.log('YT Fix: all sidebar videos already seen — blocking autoplay');
      blockYouTubeAutoplay();
      return;
    }
  }

  if (chosen) {
    console.log(`YT Fix: ▶ navigating to "${chosen.title}"`);
    window.location.href = `https://www.youtube.com/watch?v=${chosen.id}`;
  }
}

// ── Block YouTube's own autoplay from firing ──────────────────
// Pauses the video and cancels any countdown overlay YT shows.
function blockYouTubeAutoplay() {
  const video = document.querySelector('video');
  if (video) video.pause();

  // Cancel YT's autoplay countdown UI
  const cancelBtn = document.querySelector('.ytp-autonav-endscreen-countdown-overlay button, .ytp-upnext-cancel-button');
  if (cancelBtn) cancelBtn.click();

  console.log('YT Fix: autoplay blocked — no suitable video found');
}

// ── Sidebar ───────────────────────────────────────────────────
function getSidebarVideos() {
  const items = [];
  document.querySelectorAll('ytd-compact-video-renderer').forEach(el => {
    const link  = el.querySelector('a#thumbnail');
    const title = el.querySelector('#video-title')?.textContent?.trim() || '';
    if (!link || !title) return;

    let id = null;
    try {
      id = new URLSearchParams(new URL(link.href, location.origin).search).get('v');
    } catch(e) {}
    if (!id) return;

    items.push({ id, title, tags: titleToTags(title.toLowerCase()) });
  });
  return items;
}

function isRelated(videoTags, currentTags) {
  if (!currentTags.length || !videoTags.length) return true;
  return videoTags.some(t => currentTags.includes(t));
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
}