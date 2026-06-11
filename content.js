

console.log('YT Fix: loaded');

let currentMode    = 'off';
let watchedVideos  = {};
let currentVideoId = null;
let hasIntercepted = false;


chrome.storage.local.get(['mode', 'watchedVideos'], (data) => {
  currentMode   = data.mode          || 'off';
  watchedVideos = data.watchedVideos || {};
  console.log(`YT Fix: mode=${currentMode}, tracked=${Object.keys(watchedVideos).length} videos`);
  init();
});

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

  video.addEventListener('ended', () => {
    stopCounting();
    console.log('YT Fix: ended event');
    if (currentMode !== 'off' && !hasIntercepted) {
      hasIntercepted = true;
      setTimeout(handleAutoplay, 1500);
    }
  });

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


const CHIP_NOISE = new Set([
  'all','related','for you','recently uploaded','watched','new to you',
  'from the series','from netflix','from hbo','from disney+','from amazon',
  'trailers','movies','music','gaming','news','live','purchased',
  'continue watching','top picks','posts'
]);

function extractTags() {
  const tags = [];


  tags.push(...titleToTags(document.title.toLowerCase()));


  const channel = document.querySelector(
    'ytd-channel-name yt-formatted-string a, #channel-name a, #owner #channel-name a'
  );
  if (channel) {
    const ch = channel.textContent.trim().toLowerCase();

    tags.push(...titleToTags(ch));
  }

  return [...new Set(tags)];
}

function titleToTags(text) {
  const map = {
    music:       ['music','song','official audio','official video','lyrics','ft.','feat.','audio'],
    afrobeats:   ['afrobeats','afro','amapiano','afropop','wizkid','burna boy','rema','ruger','davido','don toliver','afroswing'],
    hiphop:      ['hip hop','hiphop','rap','drill','trap','freestyle','cypher','kendrick','drake'],
    rnb:         ['r&b','rnb','soul','neo soul'],
    indian:      ['bollywood','hindi','punjabi','tollywood','desi','bhangra','classical indian','tamil','telugu'],
    horror:      ['horror','scary','thriller','haunted','creepy','ghost','supernatural','paranormal','slasher','terror'],
    trailer:     ['trailer','official trailer','teaser','clip','preview'],
    gaming:      ['gameplay',"let's play",'walkthrough','gaming','playthrough','speedrun','minecraft','fortnite','gta'],
    comedy:      ['funny','comedy','meme','prank','try not to laugh','fails','roast'],
    documentary: ['documentary','explained','history of','true story','real life','biography'],
    anime:       ['anime','manga','one piece','naruto','demon slayer','attack on titan'],
    politics:    ['politics','election','government','president','policy','news','breaking'],
    cartoon:     ['cartoon','animated','tom and jerry','looney tunes','animation','pixar'],
  };

  const found = [];
  for (const [genre, keywords] of Object.entries(map)) {
    if (keywords.some(k => text.includes(k))) found.push(genre);
  }
  return found;
}

function handleAutoplay() {
  if (currentMode === 'off') return;

  const candidates = getSidebarVideos();
  const currentTags = extractTags();

  console.log(`YT Fix: handleAutoplay | mode=${currentMode} | ${candidates.length} candidates | tags=[${currentTags}]`);
  if (candidates.length === 0) {
    console.warn('YT Fix: ⚠️ 0 candidates — sidebar scraper found nothing. DOM may have changed.');
    debugSidebar();
    return;
  }

  candidates.forEach(v => {
    console.log(`  candidate: "${v.title}" | id=${v.id} | seen=${!!watchedVideos[v.id]} | tags=[${v.tags}]`);
  });

  let chosen = null;

  if (currentMode === 'seen') {
    chosen = candidates.find(v => isRelated(v.tags, currentTags) && watchedVideos[v.id]);
    if (!chosen) chosen = candidates.find(v => watchedVideos[v.id]);
    if (!chosen) {
      console.log('YT Fix: no watched videos in sidebar — blocking autoplay');
      blockYouTubeAutoplay();
      return;
    }

  } else if (currentMode === 'new') {
    chosen = candidates.find(v => isRelated(v.tags, currentTags) && !watchedVideos[v.id]);
    if (!chosen) chosen = candidates.find(v => !watchedVideos[v.id]);
    if (!chosen) {
      console.log('YT Fix: all sidebar videos already seen — blocking autoplay');
      blockYouTubeAutoplay();
      return;
    }
  }

  if (chosen) {
    console.log(`YT Fix: ▶ navigating to "${chosen.title}" (${chosen.id})`);
    window.location.href = `https://www.youtube.com/watch?v=${chosen.id}`;
  }
}


function getSidebarVideos() {
  const items = [];
  const seen  = new Set();


  const SELECTORS = [
    'ytd-compact-video-renderer',
    'ytd-compact-movie-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-item-renderer',
  
    'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer',
    '#secondary ytd-compact-video-renderer',
    '#related ytd-compact-video-renderer',
    '#related ytd-rich-item-renderer',
  ];

  for (const sel of SELECTORS) {
    document.querySelectorAll(sel).forEach(el => {

      const linkEl  = el.querySelector('a#thumbnail, a.ytd-thumbnail, a[href*="watch"]');
      const titleEl = el.querySelector(
        '#video-title, #video-title-link, h3 a, .title a, yt-formatted-string#video-title'
      );

      if (!linkEl || !titleEl) return;

      const title = titleEl.textContent?.trim() || titleEl.getAttribute('title') || '';
      if (!title) return;

      let id = null;
      try {
        const url = new URL(linkEl.href, location.origin);
        id = url.searchParams.get('v');
      } catch(e) {}

      if (!id || seen.has(id)) return;
      seen.add(id);

      items.push({ id, title, tags: titleToTags(title.toLowerCase()) });
    });
  }

  return items;
}


function debugSidebar() {
  console.log('YT Fix: 🔍 DOM debug — looking for any sidebar links with /watch...');
  const allLinks = document.querySelectorAll('a[href*="/watch?v="]');
  const found = [];
  allLinks.forEach(a => {
    try {
      const id = new URL(a.href).searchParams.get('v');
      const text = a.textContent?.trim() || a.getAttribute('title') || '(no text)';
      if (id && id !== currentVideoId && !found.includes(id)) {
        found.push(id);
        console.log(`  link: "${text.slice(0,60)}" → ${id} | parent: ${a.parentElement?.tagName}.${a.parentElement?.className?.slice(0,40)}`);
      }
    } catch(e) {}
  });
  console.log(`YT Fix: found ${found.length} /watch links total in DOM`);
}

function blockYouTubeAutoplay() {
  const video = document.querySelector('video');
  if (video) video.pause();

  const cancelBtn = document.querySelector(
    '.ytp-autonav-endscreen-countdown-overlay button, .ytp-upnext-cancel-button'
  );
  if (cancelBtn) cancelBtn.click();

  console.log('YT Fix: autoplay blocked');
}


function isRelated(videoTags, currentTags) {
  if (!currentTags.length || !videoTags.length) return true;
  return videoTags.some(t => currentTags.includes(t));
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
}