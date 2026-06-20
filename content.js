console.log('YT Fix: loaded');

let currentMode = 'off';
let watchedVideos = {};
let currentVideoId = null;
let hasIntercepted = false;
let candidateCache = null;
let candidateCacheVideoId = null;
let prepareTimer = null;
let activeVideoController = null;
let activeWatchSession = 0;
let nextPreviewCandidate = null; let overlayShown = false; // track overlay display
let autoImportChannelId = null; // optional stored channel id for auto‑import
let blockedChannelNames = []; // from preferences.blacklistedChannels — used to skip candidates only

const MAX_CANDIDATES_TO_ENRICH = 60;
const MAX_SEARCH_QUERIES = 4;

// Initialize preferences on first load
initializePreferences(() => {
  console.log('YT Fix: Preferences initialized');
  checkAndShowFirstTimeSetup();

  // Initialize content filtering (homepage/feed only — never on /watch)
  setTimeout(initializeContentFiltering, 1000);
});

getPreferences((prefs) => {
  blockedChannelNames = prefs.blacklistedChannels || [];
});

safeStorageGet(['mode', 'watchedVideos', 'autoImportChannelId'], (data) => {
  currentMode = data.mode || 'off';
  watchedVideos = normalizeWatchedVideos(data.watchedVideos || {});
  autoImportChannelId = data.autoImportChannelId || null;
  console.log(`YT Fix: mode=${currentMode}, tracked=${Object.keys(watchedVideos).length} videos`);
  if (autoImportChannelId) {
    console.log('YT Fix: auto‑importing channel history for', autoImportChannelId);
    importChannelHistory(autoImportChannelId);
  }
  init();
});

if (isExtensionContextAlive()) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'MODE_CHANGE') {
      currentMode = msg.mode;
      console.log('YT Fix: mode ->', currentMode);
      if (currentMode === 'off') clearNextPreview();
    }
    if (msg.type === 'IMPORT_CHANNEL_HISTORY') {
      const channelId = msg.channelId;
      if (channelId) importChannelHistory(channelId);
    }
    if (msg.type === 'CLEAR_HISTORY') {
      watchedVideos = {};
      candidateCache = null;
      clearNextPreview();
      console.log('YT Fix: history cleared');
    }
    if (msg.type === 'PREFERENCES_CHANGED') {
      console.log('YT Fix: preferences changed, refiltering content');
      setTimeout(() => {
        // Reset the filtering state and reapply
        const elements = document.querySelectorAll('[data-yt-fix-filtered]');
        elements.forEach(el => el.removeAttribute('data-yt-fix-filtered'));
        applyComprehensiveFilter();
      }, 500);
    }
    if (msg.type === 'BLACKLIST_CHANGED') {
      console.log('YT Fix: blacklist changed, refiltering content');
      getPreferences((prefs) => { blockedChannelNames = prefs.blacklistedChannels || []; });
      setTimeout(() => {
        // Reset the filtering state and reapply
        const elements = document.querySelectorAll('[data-yt-fix-filtered]');
        elements.forEach(el => el.removeAttribute('data-yt-fix-filtered'));
        applyComprehensiveFilter();
      }, 500);
    }
  });
}



// Helper: fetch all videos from a channel, following continuation tokens for pagination.
async function fetchAllChannelVideos(channelId) {
  const baseUrl = `https://www.youtube.com/channel/${channelId}/videos?view=0&sort=dd&flow=grid`;
  const videos = [];
  let html = await (await fetch(baseUrl)).text();
  videos.push(...extractVideoLinksFromHtml(html));
  let continuationMatch = html.match(/"continuation":"([^\"]+)"/);
  while (continuationMatch && continuationMatch[1]) {
    const token = continuationMatch[1];
    const jsonUrl = `https://www.youtube.com/browse_ajax?continuation=${token}&action_get=1`;
    const resp = await fetch(jsonUrl);
    if (!resp.ok) break;
    const json = await resp.json();
    // Some responses nest the HTML; try common fields.
    const innerHtml = json?.content_html || json?.response?.contents_html || '';
    if (!innerHtml) break;
    videos.push(...extractVideoLinksFromHtml(innerHtml));
    continuationMatch = innerHtml.match(/"continuation":"([^\"]+)"/);
  }
  return videos;
}

function isExtensionContextAlive() {
  return Boolean(
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.id &&
    chrome.storage &&
    chrome.storage.local
  );
}

function stopThisContentScript() {
  clearTimeout(prepareTimer);
  activeWatchSession++;
  if (activeVideoController) activeVideoController.abort();
  activeVideoController = null;
  currentMode = 'off';
}

function safeStorageGet(keys, callback) {
  if (!isExtensionContextAlive()) {
    stopThisContentScript();
    return;
  }

  try {
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        stopThisContentScript();
        console.warn('YT Fix: storage get skipped:', chrome.runtime.lastError.message);
        return;
      }
      callback(data || {});
    });
  } catch (e) {
    stopThisContentScript();
    console.warn('YT Fix: storage get failed:', e.message);
  }
}

function safeStorageSet(value, callback) {
  if (!isExtensionContextAlive()) {
    stopThisContentScript();
    return;
  }

  try {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        stopThisContentScript();
        console.warn('YT Fix: storage set skipped:', chrome.runtime.lastError.message);
        return;
      }
      if (callback) callback();
    });
  } catch (e) {
    stopThisContentScript();
    console.warn('YT Fix: storage set failed:', e.message);
  }
}

function init() {
  checkPage();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(checkPage, 900);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function checkPage() {
  if (!isExtensionContextAlive()) {
    stopThisContentScript();
    return;
  }

  const videoId = getVideoId();
  if (!videoId || videoId === currentVideoId) return;

  console.log('YT Fix: new video', videoId);
  currentVideoId = videoId;
  hasIntercepted = false;
  candidateCache = null;
  candidateCacheVideoId = null;
  nextPreviewCandidate = null;
  clearNextPreview();
  activeWatchSession++;
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
  if (activeVideoController) activeVideoController.abort();
  activeVideoController = new AbortController();
  const signal = activeVideoController.signal;
  const sessionId = activeWatchSession;
  const attachedVideoId = currentVideoId;
  let currentWatchTime = 0;
  let countingInterval = null;
  let hasRecorded = false;

  const startCounting = () => {
    if (countingInterval) return;
    countingInterval = setInterval(() => {
      if (sessionId !== activeWatchSession || attachedVideoId !== currentVideoId) {
        stopCounting();
        return;
      }

      currentWatchTime++;
      if (currentWatchTime === 10 && currentMode !== 'off') {
        prepareCandidateCache().catch((e) => console.warn('YT Fix: candidate preparation failed', e));
        // Show overlay if candidate already selected
        if (nextPreviewCandidate && !overlayShown) {
          renderNextOverlay(nextPreviewCandidate);
          overlayShown = true;
        }
      }

      const recordAfter = getRecordThreshold(video);
      if (currentWatchTime >= recordAfter && !hasRecorded) {
        hasRecorded = true;
        recordVideo(attachedVideoId);
      }
    }, 1000);
  };

  const stopCounting = () => {
    clearInterval(countingInterval);
    countingInterval = null;
  };

  // Detect native HTML5 `loop` changes reliably (handles property-only toggles
  // such as right-click -> Loop) by polling the `video.loop` property.
  try {
    let previousLoop = Boolean(video.loop);
    const loopPoll = setInterval(() => {
      if (sessionId !== activeWatchSession || attachedVideoId !== currentVideoId) {
        clearInterval(loopPoll);
        return;
      }
      const isLoop = Boolean(video.loop);
      if (isLoop === previousLoop) return;
      previousLoop = isLoop;

      if (isLoop) {
        console.log('YT Fix: loop enabled on', attachedVideoId);
        // Save existing preview so it can be restored later
        safeStorageGet(['nextVideoPreview'], (data) => {
          const existing = data.nextVideoPreview || null;
          safeStorageSet({ prevNextVideoPreview: existing }, () => {
            const title = getCurrentVideoProfile().title || document.title.replace(' - YouTube', '');
            safeStorageSet({
              nextVideoPreview: {
                id: attachedVideoId,
                title,
                url: `https://www.youtube.com/watch?v=${attachedVideoId}`,
                thumbnail: `https://i.ytimg.com/vi/${attachedVideoId}/hqdefault.jpg`,
                reason: 'Loop enabled on this video',
                mode: 'loop',
                modeLabel: 'Looping this video',
                score: null,
                source: 'loop',
                currentVideoId: attachedVideoId,
                updatedAt: Date.now()
              }
            });
          });
        });
      } else {
        console.log('YT Fix: loop disabled on', attachedVideoId);
        // Loop turned off: restore previous preview if available, otherwise clear and recompute
        safeStorageGet(['prevNextVideoPreview'], (data) => {
          const prev = data.prevNextVideoPreview;
          if (prev) {
            safeStorageSet({ nextVideoPreview: prev, prevNextVideoPreview: null });
          } else {
            clearNextPreview();
            safeStorageSet({ prevNextVideoPreview: null });
            // Recompute algorithmic preview asynchronously
            prepareCandidateCache().then((candidates) => {
              resolveCurrentProfile(attachedVideoId).then((profile) => {
                updateNextPreviewFromCandidates(candidates, profile);
              }).catch(() => {});
            }).catch(() => {});
          }
        });
      }
    }, 500);

    signal.addEventListener('abort', () => clearInterval(loopPoll));
  } catch (e) {
    console.warn('YT Fix: loop polling failed', e);
  }

  video.addEventListener('play', startCounting, { signal });
  video.addEventListener('pause', stopCounting, { signal });
  if (!video.paused) startCounting();

  video.addEventListener('ended', () => {
    stopCounting();
    if (sessionId !== activeWatchSession || attachedVideoId !== currentVideoId) return;
    // If the user enabled native loop on the video element, respect it and do not intercept.
    if (video.loop) {
      console.log('YT Fix: native loop enabled; skipping interception on ended');
      return;
    }

    if (currentMode !== 'off' && !hasIntercepted) {
      hasIntercepted = true;
      handleAutoplay();
    }
  }, { signal });

  video.addEventListener('timeupdate', () => {
    if (sessionId !== activeWatchSession || attachedVideoId !== currentVideoId) return;
    // Respect native loop if user enabled it on the HTML5 video element.
    if (video.loop) return;

    if (
      !hasIntercepted &&
      currentMode !== 'off' &&
      video.duration > 0 &&
      video.currentTime >= video.duration - 2 &&
      !video.paused
    ) {
      hasIntercepted = true;
      handleAutoplay();
    }
  }, { signal });
}

function getRecordThreshold(video) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration || duration > 120) return 30;
  return Math.max(8, Math.min(30, Math.round(duration * 0.35)));
}

function recordVideo(videoId) {
  if (!videoId) return;
  if (videoId !== currentVideoId) return;

  safeStorageGet(['watchedVideos'], async (data) => {
    if (videoId !== currentVideoId) return;

    const all = normalizeWatchedVideos(data.watchedVideos || {});
    const profile = await resolveCurrentProfile(videoId);
    if (videoId !== currentVideoId) return;

    all[videoId] = {
      id: videoId,
      title: profile.title,
      channel: profile.channel,
      description: profile.description,
      tags: profile.tags,
      profile,
      timestamp: Date.now()
    };

    watchedVideos = all;
    safeStorageSet({ watchedVideos: all }, () => {
      console.log(`YT Fix: recorded "${profile.title}" | tags=[${profile.tags.join(', ')}] | total=${Object.keys(all).length}`);
    });
  });
}

async function resolveCurrentProfile(videoId) {
  const pageProfile = getCurrentVideoProfile();

  try {
    const fetched = await fetchWatchPageMetadata(videoId);
    if (!fetched.title) return pageProfile;

    return buildProfile({
      id: videoId,
      title: fetched.title || pageProfile.title,
      channel: fetched.channel || pageProfile.channel,
      description: fetched.description || pageProfile.description,
      keywords: [fetched.keywords || '', pageProfile.tags.join(' ')].join(' ')
    });
  } catch (e) {
    console.warn('YT Fix: exact metadata check failed; using page metadata', e);
    return pageProfile;
  }
}

function normalizeWatchedVideos(videos) {
  const normalized = {};
  for (const [id, item] of Object.entries(videos || {})) {
    const profile = item.profile || buildProfile({
      id,
      title: item.title || '',
      channel: item.channel || '',
      description: item.description || '',
      keywords: (item.tags || []).join(' ')
    });

    normalized[id] = {
      ...item,
      id,
      title: item.title || profile.title || '',
      channel: item.channel || profile.channel || '',
      description: item.description || profile.description || '',
      tags: item.tags?.length ? item.tags : profile.tags,
      profile
    };
  }
  return normalized;
}

const CATEGORY_RULES = {
  format: {
    trailer: ['trailer', 'official trailer', 'teaser', 'preview', 'final trailer', 'clip'],
    musicVideo: ['official music video', 'music video', 'official video', 'vevo'],
    audio: ['official audio', 'lyrics', 'lyric video', 'visualizer', 'album'],
    podcast: ['podcast', 'episode', 'interview', 'conversation', 'talks with'],
    documentary: ['documentary', 'docuseries', 'explained', 'investigation', 'true story', 'real life'],
    gameplay: ['gameplay', "let's play", 'walkthrough', 'playthrough', 'speedrun', 'stream highlights'],
    comedyClip: ['stand up', 'stand-up', 'sketch', 'try not to laugh', 'prank', 'roast', 'funny moments'],
    news: ['breaking news', 'news', 'live update', 'press briefing']
  },
  movieGenre: {
    horror: ['horror', 'haunted', 'ghost', 'supernatural', 'paranormal', 'possession', 'slasher', 'demonic', 'creepy', 'scary', 'terror'],
    thriller: ['thriller', 'suspense', 'psychological thriller', 'crime thriller', 'mystery thriller', 'cat and mouse'],
    comedy: ['comedy', 'romantic comedy', 'rom com', 'funny movie', 'laugh out loud', 'satire'],
    action: ['action', 'martial arts', 'explosive', 'fight scene', 'assassin', 'superhero'],
    drama: ['drama', 'emotional', 'family drama', 'period drama'],
    romance: ['romance', 'romantic', 'love story'],
    scifi: ['sci-fi', 'science fiction', 'space opera', 'alien invasion', 'dystopian', 'cyberpunk'],
    fantasy: ['fantasy', 'magic', 'dragon', 'mythical', 'sorcery'],
    animation: ['animated', 'animation', 'cartoon', 'pixar', 'dreamworks'],
    documentary: ['documentary', 'docuseries', 'true story', 'based on true events']
  },
  musicGenre: {
    afrobeats: [
      'afrobeats', 'afrobeat', 'afropop', 'afro pop', 'amapiano', 'bongo flava',
      'gengetone', 'dancehall africa', 'afro fusion', 'naija', 'bongo', 'azonto',
      'kuduro', 'kizomba', 'burna boy', 'wizkid', 'davido', 'rema', 'ayra starr',
      'tems', 'tiwa savage', 'asake', 'kizz daniel', 'omah lay', 'fireboy dml',
      'diamond platnumz', 'sauti sol', 'harmonize', 'zuchu', 'rayvanny', 'joeboy',
      'ckay', 'oxlade', 'tekno', 'yemi alade', 'mr eazi'
    ],
    hiphop: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill', 'freestyle', 'cypher'],
    rnb: ['r&b', 'rnb', 'soul', 'neo soul', 'slow jam'],
    pop: ['pop', 'dance pop', 'electropop'],
    rock: ['rock', 'metal', 'punk', 'alternative rock', 'indie rock'],
    reggae: ['reggae', 'dancehall', 'roots reggae'],
    gospel: ['gospel', 'worship', 'praise'],
    hindi: ['hindi song', 'bollywood', 'punjabi', 'desi', 'bhangra', 'tamil song', 'telugu song'],
    latin: ['reggaeton', 'latin', 'bachata', 'salsa'],
    electronic: ['edm', 'house music', 'techno', 'trance', 'dubstep']
  },
  gamingGenre: {
    fortnite: ['fortnite', 'battle royale', 'zero build'],
    fifa: ['fifa', 'efootball', 'ea fc', 'fc 24', 'fc 25', 'ultimate team', 'fut'],
    minecraft: ['minecraft', 'bedwars', 'skyblock', 'survival minecraft'],
    gta: ['gta', 'grand theft auto', 'gta online'],
    roblox: ['roblox', 'brookhaven', 'blox fruits'],
    callOfDuty: ['call of duty', 'warzone', 'modern warfare', 'black ops'],
    racing: ['forza', 'need for speed', 'gran turismo', 'racing game'],
    horrorGame: ['horror game', 'fnaf', 'five nights at freddy', 'poppy playtime'],
    sportsGame: ['sports game', 'career mode', 'manager mode']
  },
  comedyGenre: {
    standup: ['stand up', 'stand-up', 'comedy special'],
    prank: ['prank', 'pranks'],
    memes: ['meme', 'memes', 'funny memes'],
    reaction: ['reaction', 'reacts', 'try not to laugh'],
    sketch: ['sketch', 'skit', 'comedy sketch']
  },
  podcastGenre: {
    comedy: ['comedy podcast', 'funny podcast'],
    business: ['business podcast', 'entrepreneur', 'startup'],
    sports: ['sports podcast', 'football podcast', 'nba podcast'],
    tech: ['tech podcast', 'ai podcast'],
    relationship: ['relationship podcast', 'dating podcast'],
    trueCrime: ['true crime podcast', 'crime podcast']
  },
  topic: {
    politics: ['politics', 'election', 'government', 'president', 'parliament', 'policy'],
    tech: ['technology', 'ai', 'software', 'programming', 'coding', 'gadgets'],
    sports: ['football', 'soccer', 'nba', 'ufc', 'boxing', 'cricket', 'highlights'],
    food: ['recipe', 'cooking', 'food', 'kitchen', 'restaurant'],
    finance: ['finance', 'stock market', 'investing', 'crypto', 'bitcoin', 'economy'],
    anime: ['anime', 'manga', 'one piece', 'naruto', 'demon slayer', 'jujutsu kaisen'],
    history: ['history', 'ancient', 'world war', 'empire', 'civilization'],
    science: ['science', 'physics', 'space', 'biology', 'chemistry']
  },
  language: {
    hindi: ['hindi', 'bollywood', 'punjabi', 'desi'],
    swahili: ['swahili', 'kiswahili', 'bongo'],
    spanish: ['spanish', 'espanol', 'latino'],
    korean: ['korean', 'k-pop', 'kpop', 'kdrama'],
    japanese: ['japanese', 'anime', 'j-pop', 'jpop']
  }
};

const CATEGORY_WEIGHTS = {
  format: 7,
  movieGenre: 13,
  musicGenre: 13,
  gamingGenre: 13,
  comedyGenre: 9,
  podcastGenre: 9,
  topic: 8,
  language: 5
};

const GENERIC_TERMS = new Set([
  'official', 'video', 'audio', 'trailer', 'teaser', 'clip', 'movie', 'film',
  'music', 'song', 'lyrics', 'youtube', 'netflix', 'hbo', 'disney', 'amazon',
  'universal', 'pictures', 'studios', 'channel', 'new', 'full', 'hd', '4k',
  'extended', 'final', 'exclusive', 'scene', 'preview', 'promo', 'spot'
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'from',
  'by', 'is', 'it', 'this', 'that', 'you', 'your', 'my', 'our', 'their', 'at',
  'as', 'be', 'are', 'was', 'were', 'will', 'can', 'we', 'i', 'me', 'us'
]);

const SAME_CHANNEL_WORDS = new Set([
  'netflix', 'hulu', 'hbo', 'disney', 'prime', 'amazon', 'universal', 'warner',
  'paramount', 'sony', 'lionsgate', 'vevo', 'records', 'studios', 'pictures'
]);

const FORMAT_LOCKS = {
  trailer: ['trailer', 'clip'],
  musicVideo: ['musicVideo', 'audio'],
  audio: ['audio', 'musicVideo'],
  podcast: ['podcast'],
  documentary: ['documentary'],
  gameplay: ['gameplay'],
  comedyClip: ['comedyClip'],
  news: ['news']
};

const TALKING_ABOUT_TERMS = new Set([
  'review', 'reviews', 'explained', 'breakdown', 'analysis', 'reaction', 'reacts',
  'ending', 'essay', 'theory', 'theories', 'recap', 'podcast', 'interview',
  'commentary', 'discussion'
]);

function getCurrentVideoProfile() {
  const player = window.ytInitialPlayerResponse?.videoDetails || {};
  const playerMatchesCurrent = !player.videoId || player.videoId === currentVideoId;
  const domTitle = readCurrentDomTitle();
  const title = cleanTitle(
    domTitle ||
    (playerMatchesCurrent ? player.title : '') ||
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title.replace(' - YouTube', '')
  );

  const description = (
    (playerMatchesCurrent ? player.shortDescription : '') ||
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    ''
  ).trim();

  const keywords = [
    ...(playerMatchesCurrent ? (player.keywords || []) : []),
    document.querySelector('meta[name="keywords"]')?.content || ''
  ].join(' ');

  const channel = getCurrentChannel();
  return buildProfile({ id: currentVideoId, title, channel, description, keywords });
}

function buildProfile(meta) {
  const text = [
    meta.title || '',
    meta.channel || '',
    meta.description || '',
    meta.keywords || '',
    ...(meta.tags || [])
  ].join(' ').toLowerCase();

  const categories = {};
  const tags = [];
  for (const [group, rules] of Object.entries(CATEGORY_RULES)) {
    categories[group] = [];
    for (const [name, needles] of Object.entries(rules)) {
      if (needles.some((needle) => includesPhrase(text, needle))) {
        categories[group].push(name);
        tags.push(name);
      }
    }
  }

  const tokens = weightedTokens(meta, tags);
  const contentTokens = weightedContentTokens(meta);
  const entities = extractEntities(`${meta.title || ''} ${meta.keywords || ''}`);

  return {
    id: meta.id || '',
    title: cleanTitle(meta.title || ''),
    channel: cleanTitle(meta.channel || ''),
    description: meta.description || '',
    tags: [...new Set(tags)],
    categories,
    entities,
    tokens,
    contentTokens
  };
}

function includesPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function weightedTokens(meta, tags) {
  const vector = {};
  addTokenText(vector, meta.title, 5);
  addTokenText(vector, meta.keywords, 4);
  addTokenText(vector, tags.join(' '), 7);
  addTokenText(vector, meta.description, 1);

  // Channel/studio is deliberately weak so Netflix does not beat genre.
  addTokenText(vector, stripStudioWords(meta.channel || ''), 0.4);
  return vector;
}

function weightedContentTokens(meta) {
  const vector = {};
  addTokenText(vector, meta.title, 5);
  addTokenText(vector, meta.keywords, 3);
  addTokenText(vector, meta.description, 0.8);
  return vector;
}

function addTokenText(vector, text, weight) {
  const tokens = tokenize(text || '');
  tokens.forEach((token) => {
    vector[token] = (vector[token] || 0) + weight;
  });
}

function tokenize(text) {
  const normalized = text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[''""`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const words = normalized
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !GENERIC_TERMS.has(word));

  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1])) {
      bigrams.push(`${words[i]}_${words[i + 1]}`);
    }
  }
  return [...words, ...bigrams];
}

function extractEntities(text) {
  const entities = new Set();
  const cleaned = cleanTitle(text).replace(/\([^)]*\)/g, ' ');
  const matches = cleaned.match(/\b[A-Z][A-Za-z0-9']+(?:\s+[A-Z][A-Za-z0-9']+){0,3}\b/g) || [];
  matches.forEach((match) => {
    const normalized = tokenize(match)
      .filter((token) => !GENERIC_TERMS.has(token))
      .slice(0, 4)
      .join(' ');
    if (normalized.length > 2) entities.add(normalized);
  });
  return [...entities].slice(0, 8);
}

function titleKeyphrase(title) {
  return tokenize(title)
    .filter((token) => !token.includes('_'))
    .slice(0, 5)
    .join(' ');
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+-\s+YouTube$/i, '').replace(/\s+/g, ' ').trim();
}

function readCurrentDomTitle() {
  const selectors = [
    'ytd-watch-metadata h1 yt-formatted-string',
    'h1.ytd-watch-metadata',
    '#title h1 yt-formatted-string',
    'h1.title yt-formatted-string'
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent;
    if (text && text.trim()) return text.trim();
  }
  return '';
}

function stripStudioWords(text) {
  return tokenize(text).filter((token) => !SAME_CHANNEL_WORDS.has(token)).join(' ');
}

function prepareCandidatesSoon() {
  clearTimeout(prepareTimer);
  if (currentMode === 'off' || !currentVideoId) return;

  prepareTimer = setTimeout(() => {
    prepareCandidateCache().catch((e) => console.warn('YT Fix: candidate preparation failed', e));
  }, 2500);
}

async function prepareCandidateCache() {
  if (currentMode === 'off' || !currentVideoId) return [];
  if (candidateCache && candidateCacheVideoId === currentVideoId) return candidateCache;

  const currentProfile = await resolveCurrentProfile(currentVideoId);
  const sidebar = getSidebarVideos();
  let candidates = sidebar;

  if (currentMode === 'new') {
    const searchResults = await fetchSearchCandidates(currentProfile);
    candidates = mergeCandidates(sidebar, searchResults);
  }

  if (currentMode === 'seen') {
    candidates = Object.values(watchedVideos)
      .filter((item) => item.id && item.id !== currentVideoId)
      .map((item) => ({
        id: item.id,
        title: item.title || item.profile?.title || '',
        channel: item.channel || item.profile?.channel || '',
        description: item.description || item.profile?.description || '',
        tags: item.tags || item.profile?.tags || [],
        profile: item.profile || buildProfile(item),
        source: 'history',
        timestamp: item.timestamp || 0
      }));
  } else {
    candidates = await enrichCandidates(candidates.slice(0, MAX_CANDIDATES_TO_ENRICH));
  }

  candidateCache = candidates;
  candidateCacheVideoId = currentVideoId;
  console.log(`YT Fix: prepared ${candidates.length} candidates for ${currentMode} mode`);
  updateNextPreviewFromCandidates(candidates, currentProfile);
  return candidates;
}

async function handleAutoplay() {
  if (currentMode === 'off') return;

  const currentProfile = await resolveCurrentProfile(currentVideoId);
  let candidates = [];

  try {
    candidates = await prepareCandidateCache();
  } catch (e) {
    console.warn('YT Fix: using fallback candidates after preparation error', e);
    candidates = currentMode === 'seen'
      ? Object.values(watchedVideos).map((item) => ({ ...item, source: 'history' }))
      : getSidebarVideos();
  }

  const ranked = rankCandidates(candidates, currentProfile, currentMode);
  ranked.slice(0, 8).forEach((item) => {
    console.log(
      `YT Fix candidate score=${item.score.toFixed(2)} gate=${item.gateOk} source=${item.source} ` +
      `seen=${!!watchedVideos[item.id]} "${item.title}" tags=[${item.profile.tags.join(', ')}]`
    );
  });

  const best = ranked.find((item) => item.gateOk);
  showNextPreview(best, currentProfile);
  if (!best) {
    console.log('YT Fix: no strongly related candidate found; blocking autoplay');
    blockYouTubeAutoplay();
    return;
  }

  console.log(`YT Fix: navigating to "${best.title}" (${best.id})`);
  window.location.href = `https://www.youtube.com/watch?v=${best.id}`;
}

function rankCandidates(candidates, currentProfile, mode) {
  return candidates
    .filter((candidate) => candidate.id && candidate.id !== currentVideoId)
    .filter((candidate) => mode !== 'seen' || !!watchedVideos[candidate.id])
    .filter((candidate) => mode !== 'new' || !watchedVideos[candidate.id])
    .map((candidate) => {
      const profile = candidate.profile || buildProfile(candidate);
      const score = relatednessScore(currentProfile, profile, candidate);
      return {
        ...candidate,
        profile,
        score,
        gateOk: passesRelatednessGate(currentProfile, profile, score)
      };
    })
    .sort((a, b) => b.score - a.score);
}

function relatednessScore(current, candidate, rawCandidate = {}) {
  let score = cosine(current.tokens, candidate.tokens) * 20; // increased importance of title tokens
  score += cosine(current.contentTokens, candidate.contentTokens) * 20; // increased content similarity

  for (const [group, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const boost = (group === 'movieGenre' || group === 'musicGenre' || group === 'gamingGenre') ? weight * 1.5 : weight;
    score += overlap(current.categories[group], candidate.categories[group]) * boost;
  }

  score += overlap(current.entities, candidate.entities) * 8;
  score += overlap(current.tags, candidate.tags) * 5;
  score += softTokenOverlap(current.contentTokens, candidate.contentTokens) * 10;

  const sameChannel = normalizeName(current.channel) && normalizeName(current.channel) === normalizeName(candidate.channel);
  if (sameChannel) score -= 8; // stronger negative bias

  if (rawCandidate.source === 'history') score += 2;
  if (rawCandidate.source === 'search') score += 0.6;
  if (rawCandidate.source === 'sidebar') score += 0.3; // Trailer‐specific logic — GENRE FIRST, format second
  const currentIsTrailer = current.categories.format && current.categories.format.includes('trailer');
  const candidateIsTrailer = candidate.categories.format && candidate.categories.format.includes('trailer');
  const currentHasGenre = current.categories.movieGenre.length > 0;
  if (currentIsTrailer && currentHasGenre) {
    // Current video is a genre trailer (e.g. horror trailer)
    const genreMatch = overlap(current.categories.movieGenre, candidate.categories.movieGenre) > 0;
    if (candidateIsTrailer && genreMatch) {
      score += 15; // best case: same genre + same format
    } else if (!candidateIsTrailer && genreMatch) {
      score -= 5; // same genre but wrong format — mild penalty
    } else if (candidateIsTrailer && !genreMatch) {
      score -= 20; // same format but WRONG genre — this is the afrobeats-trailer problem
    } else {
      score -= 30; // wrong genre AND wrong format
    }
  } else if (currentIsTrailer && !currentHasGenre) {
    // Current is a trailer but we couldn't detect a genre — light format preference
    if (candidateIsTrailer) {
      score += 3;
    } else {
      score -= 10;
    }
  }

  if (isClearlyWrongGenre(current, candidate)) score -= 20;
  if (isWrongFormatExperience(current, candidate)) score -= 40;
  if (isTalkingAboutInsteadOfSameFormat(current, candidate)) score -= 20;
  if (isSameTitleOrEpisodeVariant(current, candidate)) score -= 40; // reduced penalty to allow genre‑related repeats
  if (isSameTitleReupload(current, candidate)) score -= 55;
  if (hasStrongGenreLane(current) && !hasSameGenreLane(current, candidate)) score -= 25;
  return score;
}

function passesRelatednessGate(current, candidate, score) {
  if (score < 7) return false;
  if (isClearlyWrongGenre(current, candidate)) return false;
  if (isWrongFormatExperience(current, candidate)) return false;
  if (isTalkingAboutInsteadOfSameFormat(current, candidate)) return false;
  if (isSameTitleOrEpisodeVariant(current, candidate)) return false;
  if (isSameTitleReupload(current, candidate)) return false;
  if (hasStrongGenreLane(current) && !hasSameGenreLane(current, candidate)) return false;

  const currentHasOnlyTrailerFormat =
    current.categories.format.length === 1 &&
    current.categories.format.includes('trailer') &&
    !current.categories.movieGenre.length &&
    !current.categories.musicGenre.length &&
    !current.categories.gamingGenre.length &&
    !current.categories.comedyGenre.length &&
    !current.categories.podcastGenre.length &&
    !current.categories.topic.length;

  const currentHasStrongCategory =
    current.categories.movieGenre.length ||
    current.categories.musicGenre.length ||
    current.categories.gamingGenre.length ||
    current.categories.comedyGenre.length ||
    current.categories.podcastGenre.length ||
    current.categories.topic.length ||
    (current.categories.format.length && !currentHasOnlyTrailerFormat);

  if (!currentHasStrongCategory) return score >= 10;
  return hasCoreCategoryOverlap(current, candidate) || overlap(current.entities, candidate.entities) > 0 || score >= 17;
}

function hasCoreCategoryOverlap(a, b) {
  return (
    overlap(a.categories.movieGenre, b.categories.movieGenre) > 0 ||
    overlap(a.categories.musicGenre, b.categories.musicGenre) > 0 ||
    overlap(a.categories.gamingGenre, b.categories.gamingGenre) > 0 ||
    overlap(a.categories.comedyGenre, b.categories.comedyGenre) > 0 ||
    overlap(a.categories.podcastGenre, b.categories.podcastGenre) > 0 ||
    overlap(a.categories.topic, b.categories.topic) > 0 ||
    overlap(a.categories.language, b.categories.language) > 0 ||
    matchingFormats(a, b)
  );
}

function hasStrongGenreLane(profile) {
  return Boolean(
    profile.categories.movieGenre.length ||
    profile.categories.musicGenre.length ||
    profile.categories.gamingGenre.length ||
    profile.categories.comedyGenre.length ||
    profile.categories.podcastGenre.length
  );
}

function hasSameGenreLane(a, b) {
  return (
    overlap(a.categories.movieGenre, b.categories.movieGenre) > 0 ||
    overlap(a.categories.musicGenre, b.categories.musicGenre) > 0 ||
    overlap(a.categories.gamingGenre, b.categories.gamingGenre) > 0 ||
    overlap(a.categories.comedyGenre, b.categories.comedyGenre) > 0 ||
    overlap(a.categories.podcastGenre, b.categories.podcastGenre) > 0
  );
}

function matchingFormats(a, b) {
  const formatOverlap = overlap(a.categories.format, b.categories.format);
  if (formatOverlap === 0) return false;

  const onlyTrailerOverlap =
    a.categories.format.includes('trailer') &&
    b.categories.format.includes('trailer') &&
    formatOverlap === 1;
  if (!onlyTrailerOverlap) return true;

  // Trailers can relate across studios, but the movie genre still has to carry the match.
  return overlap(a.categories.movieGenre, b.categories.movieGenre) > 0;
}

function isClearlyWrongGenre(current, candidate) {
  const movieA = current.categories.movieGenre;
  const movieB = candidate.categories.movieGenre;
  const musicA = current.categories.musicGenre;
  const musicB = candidate.categories.musicGenre;
  const gameA = current.categories.gamingGenre;
  const gameB = candidate.categories.gamingGenre;
  const podcastA = current.categories.podcastGenre;
  const podcastB = candidate.categories.podcastGenre;

  if (movieA.includes('comedy') && (movieB.includes('horror') || movieB.includes('thriller'))) return true;
  if (movieA.includes('horror') && movieB.includes('comedy') && !movieB.includes('horror')) return true;
  if (musicA.length && musicB.length && overlap(musicA, musicB) === 0) return true;
  if (gameA.length && gameB.length && overlap(gameA, gameB) === 0) return true;
  if (podcastA.length && podcastB.length && overlap(podcastA, podcastB) === 0) return true;
  // A movie-genre video vs a music-genre video is always a genre clash — even if both are trailers
  if (movieA.length && musicB.length) return true;
  if (musicA.length && movieB.length) return true;
  return false;
}

function isWrongFormatExperience(current, candidate) {
  for (const format of current.categories.format) {
    const allowed = FORMAT_LOCKS[format];
    if (!allowed) continue;
    if (!candidate.categories.format.some((candidateFormat) => allowed.includes(candidateFormat))) {
      return true;
    }
  }
  return false;
}

function isTalkingAboutInsteadOfSameFormat(current, candidate) {
  const currentIsTrailer = current.categories.format.includes('trailer');
  if (!currentIsTrailer) return false;
  if (candidate.categories.format.includes('trailer') || candidate.categories.format.includes('clip')) return false;

  const candidateTokens = Object.keys(candidate.contentTokens || {});
  return candidateTokens.some((token) => TALKING_ABOUT_TERMS.has(token));
}

function isSameTitleReupload(current, candidate) {
  if (!current.categories.format.includes('trailer')) return false;
  if (!candidate.categories.format.includes('trailer')) return false;

  const currentTitle = canonicalMovieTitleWords(current.title);
  const candidateTitle = canonicalMovieTitleWords(candidate.title);
  if (!currentTitle.length || !candidateTitle.length) return false;

  return currentTitle.join(' ') === candidateTitle.join(' ');
}

function isSameTitleOrEpisodeVariant(current, candidate) {
  const currentWords = canonicalTitleIdentityWords(current.title);
  const candidateWords = canonicalTitleIdentityWords(candidate.title);
  if (currentWords.length < 2 || candidateWords.length < 2) return false;

  const shared = overlap(currentWords, candidateWords);
  const shorter = Math.min(currentWords.length, candidateWords.length);
  return shared >= 2 && shared / shorter >= 0.82;
}

function canonicalTitleIdentityWords(title) {
  const words = normalizedTitleWords(title);
  const formatIndex = words.findIndex((word) =>
    ['trailer', 'teaser', 'preview', 'clip', 'episode', 'ep', 'part', 'official', 'video', 'audio', 'lyrics'].includes(word)
  );
  const identityWords = formatIndex >= 0 ? words.slice(0, formatIndex) : words;

  return identityWords
    .filter((word) => !STOPWORDS.has(word))
    .filter((word) => !GENERIC_TERMS.has(word))
    .filter((word) => !SAME_CHANNEL_WORDS.has(word))
    .filter((word) => !/^\d+$/.test(word));
}

function canonicalMovieTitleWords(title) {
  const words = normalizedTitleWords(title);
  const trailerIndex = words.findIndex((word) => word === 'trailer' || word === 'teaser' || word === 'preview');
  const titleWords = trailerIndex >= 0 ? words.slice(0, trailerIndex) : words;

  return titleWords
    .filter((word) => !STOPWORDS.has(word))
    .filter((word) => !GENERIC_TERMS.has(word))
    .filter((word) => !SAME_CHANNEL_WORDS.has(word));
}

function normalizedTitleWords(title) {
  return cleanTitle(title)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[''""`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function overlap(a = [], b = []) {
  const bSet = new Set(b);
  return [...new Set(a)].filter((item) => bSet.has(item)).length;
}

function softTokenOverlap(a = {}, b = {}) {
  const keysA = Object.keys(a).filter((key) => !GENERIC_TERMS.has(key));
  const keysB = new Set(Object.keys(b).filter((key) => !GENERIC_TERMS.has(key)));
  if (!keysA.length || !keysB.size) return 0;

  const shared = keysA.filter((key) => keysB.has(key));
  return shared.length / Math.max(6, Math.min(keysA.length, keysB.size));
}

function hasAnyToken(vector = {}, tokens = []) {
  return tokens.some((token) => Boolean(vector[token]));
}

function cosine(a = {}, b = {}) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const value of Object.values(a)) magA += value * value;
  for (const value of Object.values(b)) magB += value * value;
  for (const [token, value] of Object.entries(a)) {
    if (b[token]) dot += value * b[token];
  }

  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

async function enrichCandidates(candidates) {
  const unique = mergeCandidates(candidates);
  const metas = await Promise.all(
    unique.map((candidate) =>
      fetchWatchPageMetadata(candidate.id).catch(() => candidate)
    )
  );

  return unique.map((candidate, index) => {
    const meta = metas[index] || candidate;
    const merged = {
      ...candidate,
      ...meta,
      title: meta.title || candidate.title,
      channel: meta.channel || candidate.channel || '',
      description: meta.description || candidate.description || '',
      keywords: [meta.keywords || '', (candidate.tags || []).join(' ')].join(' '),
      source: candidate.source || 'sidebar'
    };
    merged.profile = buildProfile(merged);
    merged.tags = merged.profile.tags;
    return merged;
  });
}

async function fetchWatchPageMetadata(videoId) {
  if (!videoId) return {};
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  if (!res.ok) throw new Error(`watch fetch failed: ${res.status}`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = cleanTitle(
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.title ||
    ''
  );
  const description = (
    doc.querySelector('meta[name="description"]')?.content ||
    doc.querySelector('meta[property="og:description"]')?.content ||
    ''
  ).trim();
  const keywords = doc.querySelector('meta[name="keywords"]')?.content || '';
  const channel = extractChannelFromHtml(html) || '';
  return { id: videoId, title, description, keywords, channel };
}

async function fetchSearchCandidates(currentProfile) {
  const queries = buildSearchQueries(currentProfile).slice(0, MAX_SEARCH_QUERIES);
  const batches = await Promise.all(queries.map((query) => fetchSearchResults(query)));
  return mergeCandidates(...batches).map((candidate) => ({ ...candidate, source: 'search' }));
}

function buildSearchQueries(profile) {
  const movieGenre = profile.categories.movieGenre[0] || '';
  const musicGenre = profile.categories.musicGenre[0] || '';
  const gamingGenre = profile.categories.gamingGenre[0] || '';
  const comedyGenre = profile.categories.comedyGenre[0] || '';
  const podcastGenre = profile.categories.podcastGenre[0] || '';
  const topic = profile.categories.topic[0] || '';
  const genre = movieGenre || musicGenre || gamingGenre || comedyGenre || podcastGenre || topic || '';
  const format = profile.categories.format[0] || '';
  const entity = profile.entities[0] || '';
  const titleWords = titleKeyphrase(profile.title);

  const queries = [];
  if (profile.categories.format.includes('trailer')) {
    if (movieGenre) queries.push(`${movieGenre} movie trailer`);
    if (movieGenre) queries.push(`new ${movieGenre} movie trailer`);
    if (movieGenre) queries.push(`${movieGenre} official trailer`);
    if (!movieGenre && topic) queries.push(`${topic} movie trailer`);
    if (!movieGenre && !topic && entity) queries.push(`${entity} movie trailer`);
    if (hasAnyToken(profile.contentTokens, ['superhero', 'superman', 'batman', 'justice', 'league', 'dc', 'comic'])) {
      queries.push('superhero action movie trailer');
    }
  } else if (musicGenre) {
    queries.push(`${musicGenre} music video`);
    queries.push(`${musicGenre} official music video`);
    queries.push(`${musicGenre} latest songs`);
    if (entity && !entityLooksLikeCurrentTitle(entity, titleWords)) queries.push(`${entity} ${musicGenre} music`);
  } else if (gamingGenre) {
    queries.push(`${gamingGenre} gameplay`);
    queries.push(`${gamingGenre} walkthrough`);
  } else if (comedyGenre) {
    queries.push(`${comedyGenre} funny video`);
  } else if (podcastGenre) {
    queries.push(`${podcastGenre} podcast episode`);
  }
  if (!profile.categories.format.includes('trailer') && !musicGenre && entity && genre && !entityLooksLikeCurrentTitle(entity, titleWords)) {
    queries.push(`${entity} ${genre} ${format}`.trim());
  }
  if (genre && format) queries.push(`${genre} ${format}`.trim());
  if (titleWords && !hasStrongGenreLane(profile) && !profile.categories.format.includes('trailer')) queries.push(`${titleWords} related`);
  return [...new Set(queries.filter(Boolean))];
}

function entityLooksLikeCurrentTitle(entity, titleWords) {
  if (!entity || !titleWords) return false;
  const entityTokens = tokenize(entity).filter((token) => !token.includes('_'));
  const titleTokens = new Set(tokenize(titleWords).filter((token) => !token.includes('_')));
  if (!entityTokens.length || !titleTokens.size) return false;
  return entityTokens.every((token) => titleTokens.has(token));
}

async function fetchSearchResults(query) {
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`);
    if (!res.ok) return [];
    const html = await res.text();
    return extractVideoLinksFromHtml(html).slice(0, 18);
  } catch (e) {
    console.warn('YT Fix: search fetch failed', query, e);
    return [];
  }
}

function extractVideoLinksFromHtml(html) {
  const results = [];
  const seen = new Set();
  const re = /"videoId":"([^"]+)".{0,900}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  let match;

  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    const title = decodeJsonString(match[2]);
    if (!id || seen.has(id) || id === currentVideoId || !title) continue;
    seen.add(id);
    results.push({
      id,
      title,
      channel: '',
      description: '',
      keywords: '',
      source: 'search',
      profile: buildProfile({ id, title })
    });
  }
  return results;
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch (e) {
    return value.replace(/\\u0026/g, '&').replace(/\\"/g, '"');
  }
}

function mergeCandidates(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((candidate) => {
    if (!candidate?.id || seen.has(candidate.id) || candidate.id === currentVideoId) return;
    seen.add(candidate.id);
    merged.push(candidate);
  });
  return merged;
}

function getSidebarVideos() {
  const items = [];
  const seen = new Set();
  const selectors = [
    'ytd-compact-video-renderer',
    'ytd-compact-movie-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-item-renderer',
    '#secondary a[href*="/watch?v="]',
    '#related a[href*="/watch?v="]'
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      const linkEl = el.matches?.('a[href*="/watch?v="]')
        ? el
        : el.querySelector('a#thumbnail, a.ytd-thumbnail, a[href*="/watch?v="]');
      const titleEl = el.querySelector?.('#video-title, #video-title-link, h3 a, .title a, yt-formatted-string#video-title');
      const channelEl = el.querySelector?.('ytd-channel-name a, ytd-channel-name yt-formatted-string, #channel-name a, .ytd-channel-name');

      if (!linkEl) return;
      const title = cleanTitle(
        titleEl?.textContent ||
        titleEl?.getAttribute?.('title') ||
        linkEl.getAttribute('title') ||
        linkEl.getAttribute('aria-label') ||
        ''
      );
      if (!title) return;

      const channel = cleanTitle(channelEl?.textContent || '');
      if (channel && blockedChannelNames.length) {
        const channelLower = channel.toLowerCase();
        const isBlocked = blockedChannelNames.some((name) => channelLower.includes(String(name).toLowerCase()));
        if (isBlocked) return; // never offer this channel as a next-video candidate
      }

      let id = null;
      try {
        id = new URL(linkEl.href, location.origin).searchParams.get('v');
      } catch (e) {}

      if (!id || seen.has(id) || id === currentVideoId) return;
      seen.add(id);
      items.push({
        id,
        title,
        channel,
        description: '',
        keywords: '',
        source: 'sidebar',
        profile: buildProfile({ id, title })
      });
    });
  });

  return items;
}

function getCurrentChannel() {
  return cleanTitle(
    document.querySelector('ytd-channel-name yt-formatted-string a, #channel-name a, #owner #channel-name a')?.textContent ||
    window.ytInitialPlayerResponse?.videoDetails?.author ||
    ''
  );
}

function extractChannelFromHtml(html) {
  const patterns = [
    /"ownerChannelName":"([^"]+)"/,
    /"author":"([^"]+)"/,
    /"name":"([^"]+)","navigationEndpoint":\{"clickTrackingParams":"[^"]+","commandMetadata":\{"webCommandMetadata":\{"url":"\/@/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeJsonString(match[1]);
  }
  return '';
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

function updateNextPreviewFromCandidates(candidates, currentProfile) {
  if (currentMode === 'off') {
    clearNextPreview();
    return;
  }

  const ranked = rankCandidates(candidates, currentProfile, currentMode);
  const best = ranked.find((item) => item.gateOk);
  showNextPreview(best, currentProfile);
}

function showNextPreview(candidate, currentProfile) {
  const videoEl = document.querySelector('video');
  // If loop is active on the player, preserve the loop-set preview and
  // avoid overwriting it with algorithmic picks.
  if (videoEl && videoEl.loop) {
    if (!candidate || !candidate.id) {
      // When loop is active and there is no candidate, keep existing loop preview.
      console.log('YT Fix: loop active; skipping clear of preview');
      return;
    }
    // If candidate is the same as the currently-looped video, no change needed.
    const currentLoopId = nextPreviewCandidate?.id || (videoEl && new URLSearchParams(location.search).get('v'));
    if (candidate.id !== currentLoopId && candidate.source !== 'loop') {
      console.log('YT Fix: loop active; preserving loop preview instead of overwriting with candidate', candidate.id);
      return;
    }
  }

  if (!candidate || !candidate.id) {
    nextPreviewCandidate = null;
    clearNextPreview();
    removeNextOverlay(); // ensure no placeholder UI before candidate ready
    return;
  }

  nextPreviewCandidate = candidate;
  const title = candidate.title || candidate.profile?.title || 'Untitled video';
  const reason = describeCandidateReason(candidate, currentProfile);
  const modeLabel = currentMode === 'seen' ? 'from your history' : 'fresh pick';

  safeStorageSet({
    nextVideoPreview: {
      id: candidate.id,
      title,
      url: `https://www.youtube.com/watch?v=${candidate.id}`,
      thumbnail: `https://i.ytimg.com/vi/${candidate.id}/hqdefault.jpg`,
      reason,
      mode: currentMode,
      modeLabel,
      score: Number.isFinite(candidate.score) ? Number(candidate.score.toFixed(1)) : null,
      source: candidate.source || '',
      currentVideoId,
      updatedAt: Date.now()
    }
  });

}

function renderNextOverlay(candidate) {
  removeNextOverlay();
  const container = document.createElement('div');
  container.id = 'yt-fix-next-overlay';
  // Fixed positioning for absolute children
  container.style.position = 'fixed';
  container.style.bottom = '20px';
  container.style.right = '20px';
  container.style.zIndex = '9999';
  container.style.background = 'rgba(0,0,0,0.8)';
  container.style.color = '#fff';
  container.style.padding = '10px';
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
  container.style.cursor = 'pointer';

  container.innerHTML = `
    <img src="https://i.ytimg.com/vi/${candidate.id}/mqdefault.jpg" style="width:120px;height:auto;border-radius:4px;display:block;margin-bottom:6px;" />
    <div style="font-size:14px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${candidate.title}</div>
    <div style="font-size:12px;opacity:0.8;">Next up</div>
  `;

  // Refresh button (top‑right)
  const refreshBtn = document.createElement('button');
  refreshBtn.id = 'yt-fix-refresh-button';
  refreshBtn.textContent = 'Refresh';
  Object.assign(refreshBtn.style, {
    position: 'absolute',
    top: '4px',
    right: '4px',
    padding: '4px 8px',
    background: '#ff6600',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    zIndex: '10000'
  });
  container.appendChild(refreshBtn);

  // Close button (top‑left)
  const closeBtn = document.createElement('button');
  closeBtn.id = 'yt-fix-close-button';
  closeBtn.textContent = '✖';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '4px',
    left: '4px',
    padding: '2px 6px',
    background: 'transparent',
    color: '#fff',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    zIndex: '10000'
  });
  container.appendChild(closeBtn);

  // Handlers
  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshCandidate();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeNextOverlay();
  });

  container.onclick = () => {
    window.location.href = `https://www.youtube.com/watch?v=${candidate.id}`;
  };

  document.body.appendChild(container);
}

function refreshCandidate() {
  console.log('Refresh clicked - attempting to update next preview');
  // Re‑run candidate preparation and preview update
  // Note: this is a best‑effort placeholder; actual refresh logic may vary.
  try {
    // Use existing functions to recompute candidates for current video
    const currentProfilePromise = resolveCurrentProfile(currentVideoId);
    currentProfilePromise.then((profile) => {
      prepareCandidateCache().then((candidates) => {
        updateNextPreviewFromCandidates(candidates, profile);
      });
    });
  } catch (e) {
    console.warn('Refresh candidate failed', e);
  }
}

async function importChannelHistory(channelId) {
  try {
    const url = `https://www.youtube.com/channel/${channelId}/videos?view=0&sort=dd&flow=grid`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('YT Fix: failed to fetch channel videos', res.status);
      return;
    }
    const html = await res.text();
    const videos = extractVideoLinksFromHtml(html);
    if (!videos.length) {
      console.warn('YT Fix: no videos found for channel', channelId);
      return;
    }
    // Add each video to watchedVideos storage
    safeStorageGet(['watchedVideos'], async (data) => {
      const all = normalizeWatchedVideos(data.watchedVideos || {});
      const now = Date.now();
      for (const vid of videos) {
        if (!all[vid.id]) {
          // store minimal info; title will be fetched later if needed
          all[vid.id] = {
            id: vid.id,
            title: vid.title || '',
            channel: getCurrentChannel(),
            description: '',
            tags: [],
            profile: null,
            timestamp: now
          };
        }
      }
      watchedVideos = all;
      safeStorageSet({ watchedVideos: all }, () => {
        console.log(`YT Fix: imported ${videos.length} channel videos into watched history`);
      });
    });
  } catch (e) {
    console.warn('YT Fix: error importing channel history', e);
  }
}


function clearNextPreview() {
  nextPreviewCandidate = null; overlayShown = false; // track if overlay displayed for current video
  safeStorageSet({ nextVideoPreview: null });
}

function describeCandidateReason(candidate, currentProfile) {
  const candidateProfile = candidate.profile;
  if (!candidateProfile) return 'Matched by related video signals.';

  const groups = ['movieGenre', 'musicGenre', 'gamingGenre', 'comedyGenre', 'podcastGenre', 'topic', 'format'];
  const shared = [];

  groups.forEach((group) => {
    const currentValues = currentProfile?.categories?.[group] || [];
    const candidateValues = candidateProfile.categories?.[group] || [];
    candidateValues.forEach((value) => {
      if (currentValues.includes(value) && !shared.includes(value)) shared.push(value);
    });
  });

  if (shared.length) {
    return `Selected because it shares ${shared.slice(0, 3).map(labelizeTag).join(', ')} with the current video.`;
  }

  if (candidate.source === 'history') return 'Selected from your watched history because it scored closest to the current video.';
  if (candidate.source === 'search') return 'Selected from a genre search because it scored closest to the current video.';
  return 'Selected from YouTube suggestions because it scored closest to the current video.';
}

function labelizeTag(tag) {
  return String(tag || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function getVideoId() {
  return new URLSearchParams(location.search).get('v');
}