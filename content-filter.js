// Comprehensive content filtering system — HOMEPAGE / FYP ONLY.
//
// IMPORTANT: this never runs on /watch pages. The autoplay engine in
// content.js reads live recommendation DOM nodes (ytd-compact-video-renderer,
// ytd-rich-item-renderer, etc.) to pick the next video. If this filter
// touches those same nodes while a video is playing, it starves the
// autoplay engine of candidates and YouTube's native autoplay takes back
// over. Keeping this scoped to the homepage/feed makes that collision
// impossible by construction.

let filteringActive = false;
let currentPreferences = null;
let feedObserver = null;
let pageWatchInterval = null;
let lastUrl = location.href;
let rescanQueued = false;

function isWatchPage() {
  return location.pathname === '/watch';
}

// Pages where the FYP/recommendation filter is allowed to run.
function isFilterablePage() {
  if (isWatchPage()) return false;
  return (
    location.pathname === '/' ||
    location.pathname.startsWith('/feed') ||
    location.pathname.startsWith('/results') // search results, optional but harmless
  );
}

// Initialize filtering
function initializeContentFiltering() {
  console.log('YT Fix: Initializing content filtering (homepage-only)');

  getPreferences((prefs) => {
    currentPreferences = prefs;

    const hasGenrePrefs = prefs.hasSetupPreferences && Object.keys(prefs.selectedGenres || {}).length > 0;
    const hasBlacklist = (prefs.blacklistedChannels || []).length > 0;
    filteringActive = hasGenrePrefs || hasBlacklist;

    if (!filteringActive) {
      console.log('YT Fix: Filtering inactive (no preferences set)');
      return;
    }

    console.log(`YT Fix: Filtering armed (genres=${hasGenrePrefs}, blacklist=${hasBlacklist}) — homepage only`);

    runFilterIfAllowed();
    watchForFeedMutations();
    watchForPageTypeChanges();
  });
}

// Re-applies/tears down filtering as the user navigates the SPA between the
// homepage and a watch page, without ever running both at once.
function watchForPageTypeChanges() {
  if (pageWatchInterval) return;
  pageWatchInterval = setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    if (isFilterablePage()) {
      runFilterIfAllowed();
    } else {
      stopFeedObserver();
    }
  }, 800);
}

function watchForFeedMutations() {
  if (feedObserver) return;
  feedObserver = new MutationObserver(() => {
    if (!isFilterablePage()) return;
    // Debounce: many mutations fire in a burst as the feed loads.
    if (rescanQueued) return;
    rescanQueued = true;
    setTimeout(() => {
      rescanQueued = false;
      runFilterIfAllowed();
    }, 400);
  });
  feedObserver.observe(document.body, { childList: true, subtree: true });
}

function stopFeedObserver() {
  // Keep the observer attached (cheap when gated by isFilterablePage in the
  // callback) — just skip work while on a watch page.
}

function runFilterIfAllowed() {
  if (!filteringActive || !isFilterablePage()) return;
  applyComprehensiveFilter();
}

function applyComprehensiveFilter() {
  if (!filteringActive || !currentPreferences || !isFilterablePage()) return;

  // Homepage/feed renderer types only — deliberately excludes the
  // ytd-compact-video-renderer / "#related" elements the autoplay engine
  // depends on, since those only ever appear on /watch pages anyway.
  const selectors = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer'
  ];

  document.querySelectorAll(selectors.join(',')).forEach(element => {
    evaluateAndFilterElement(element);
  });
}

function evaluateAndFilterElement(element) {
  if (element.hasAttribute('data-yt-fix-filtered')) {
    return;
  }
  element.setAttribute('data-yt-fix-filtered', 'true');

  const videoInfo = extractVideoInfo(element);

  if (!videoInfo.title || videoInfo.title.length < 2) {
    return;
  }

  if (currentPreferences?.blacklistedChannels && currentPreferences.blacklistedChannels.length > 0) {
    for (const blacklisted of currentPreferences.blacklistedChannels) {
      if (videoInfo.title.toLowerCase().includes(blacklisted.toLowerCase()) ||
          videoInfo.channel.toLowerCase().includes(blacklisted.toLowerCase())) {
        hideElement(element);
        return;
      }
    }
  }

  const hasGenrePrefs = currentPreferences?.hasSetupPreferences &&
    Object.keys(currentPreferences.selectedGenres || {}).length > 0;
  if (!hasGenrePrefs) return; // blacklist-only mode: leave everything else alone

  const shouldShow = matchesSelectedGenres(videoInfo);
  if (!shouldShow) {
    hideElement(element);
  }
}

function extractVideoInfo(element) {
  const info = { title: '', channel: '', description: '' };

  try {
    let titleElem = element.querySelector('#video-title, h3 a, a#video-title-link, yt-formatted-string.style-scope.ytd-video-renderer');
    if (titleElem) {
      info.title = titleElem.getAttribute('title') || titleElem.textContent || '';
    }
    if (!info.title) {
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) info.title = ariaLabel;
    }

    let channelElem = element.querySelector('ytd-channel-name a, a.yt-user-name, #channel-name a');
    if (channelElem) {
      info.channel = channelElem.textContent.trim().replace(/\n/g, ' ');
    }

    let descElem = element.querySelector('yt-formatted-string.content-hint, #description-snippet');
    if (descElem) {
      info.description = descElem.textContent.trim();
    }
  } catch (e) {
    // Silently ignore
  }

  return info;
}

function matchesSelectedGenres(videoInfo) {
  if (!currentPreferences?.selectedGenres) return true;

  const selectedGenres = currentPreferences.selectedGenres;
  const allText = (videoInfo.title + ' ' + videoInfo.channel + ' ' + videoInfo.description).toLowerCase().trim();

  if (!allText || allText.length < 2) return false;

  for (const genreKey of Object.keys(selectedGenres)) {
    if (genreMatchesText(genreKey, allText)) {
      return true;
    }
  }

  return false;
}

function genreMatchesText(genreKey, textLower) {
  const { category, genre } = parseGenreKey(genreKey);
  const keywords = getStrictGenreKeywords(category, genre);

  for (const keyword of keywords) {
    if (textLower.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function getStrictGenreKeywords(category, genre) {
  const keywordMap = {
    'Afro': ['afro', 'amapiano', 'afrobeats'],
    'Pop': ['pop music', 'top 40', 'pop'],
    'Hip-Hop/Rap': ['hip hop', 'hiphop', 'rap', 'rapper', 'hip-hop', 'trap'],
    'R&B': ['r&b', 'rnb', 'rhythm blues'],
    'Rock': ['rock music', 'rock band', 'rock'],
    'Metal': ['metal', 'heavy metal'],
    'Country': ['country music', 'country'],
    'Electronic/EDM': ['edm', 'electronic', 'dubstep', 'house music', 'techno'],
    'Jazz': ['jazz', 'jazz music'],
    'Classical': ['classical', 'classical music', 'orchestra'],
    'Reggae': ['reggae', 'dancehall'],
    'Latin': ['latin music', 'salsa', 'reggaeton', 'latino'],
    'Bollywood': ['bollywood', 'hindi music', 'hindi song'],
    'K-Pop': ['kpop', 'k-pop', 'korean music'],
    'Folk': ['folk music'],
    'Blues': ['blues music'],
    'Horror': ['horror movie', 'horror trailer', 'scary movie', 'supernatural'],
    'Action': ['action movie', 'action trailer', 'action film'],
    'Comedy': ['comedy movie', 'comedy trailer', 'comedy film'],
    'Drama': ['drama movie', 'drama trailer', 'drama film'],
    'Adventure': ['adventure movie', 'adventure trailer'],
    'Sci-Fi': ['sci fi movie', 'sci-fi', 'science fiction', 'sci-fi movie'],
    'Fantasy': ['fantasy movie', 'fantasy trailer', 'magical world'],
    'Thriller': ['thriller movie', 'thriller trailer'],
    'Mystery': ['mystery movie', 'mystery trailer', 'detective'],
    'Romance': ['romance movie', 'romantic film'],
    'Animation': ['animated movie', 'animation trailer', 'anime'],
    'Crime': ['crime movie', 'crime thriller'],
    'Western': ['western movie', 'cowboy'],
    'War': ['war movie', 'military movie'],
    'Superhero': ['superhero movie', 'marvel', 'dc comics'],
    'Korean': ['korean movie', 'k-drama'],
    'Japanese': ['japanese movie', 'anime movie'],
    'Comedy Shorts': ['short film', 'short comedy', 'short'],
    'Horror Shorts': ['short horror', 'horror short'],
    'Drama Shorts': ['short drama'],
    'Fun and jokes': ['funny podcast', 'comedy podcast'],
    'Sports (Podcasts)': ['sports podcast', 'sports talk show'],
    'Politics': ['political podcast', 'politics podcast', 'news podcast'],
    'Technology': ['tech podcast', 'technology podcast'],
    'Business/Entrepreneurship': ['business podcast', 'entrepreneur', 'startup'],
    'True Crime': ['true crime podcast', 'crime podcast'],
    'Self-Help/Wellness': ['wellness podcast', 'meditation'],
    'Science': ['science podcast'],
    'History': ['history podcast'],
    'Animals/Nature': ['nature documentary', 'animal documentary', 'wildlife'],
    'Crime/True Crime': ['crime documentary', 'true crime'],
    'Science/Technology': ['science documentary', 'tech documentary'],
    'Environmental': ['environmental documentary', 'climate documentary'],
    'Space/Universe': ['space documentary', 'cosmos', 'universe documentary'],
    'Biography': ['biography documentary', 'biographical'],
    'Football/Soccer': ['football', 'soccer', 'goal', 'match', 'premier league', 'champions league'],
    'Basketball': ['basketball', 'nba', 'game', 'highlight'],
    'American Football': ['american football', 'nfl', 'football game'],
    'Baseball': ['baseball', 'mlb'],
    'Tennis': ['tennis', 'tennis match', 'wimbledon'],
    'Cricket': ['cricket', 'cricket match', 'cricket game'],
    'Hockey': ['hockey', 'nhl'],
    'Boxing/MMA': ['boxing', 'mma', 'ufc', 'fight', 'knockout'],
    'Motorsports': ['formula 1', 'f1', 'racing', 'nascar', 'rally'],
    'Cycling': ['cycling', 'tour de france', 'bike'],
    'Volleyball': ['volleyball', 'volleyball game'],
    'Golf': ['golf', 'pga', 'golf tournament'],
    'Rugby': ['rugby', 'rugby match'],
    "Let's Plays": ["let's play", 'gameplay', 'playthrough'],
    'Game Reviews': ['game review', 'video game review'],
    'Speedruns': ['speedrun', 'world record'],
    'Esports/Tournaments': ['esports', 'gaming tournament', 'competitive'],
    'Game Trailers': ['game trailer'],
    'Streaming Highlights': ['gaming stream', 'twitch', 'highlight'],
    'Breaking News': ['breaking news', 'news report'],
    'International': ['international news'],
    'Technology News': ['tech news', 'technology news'],
    'Business News': ['business news', 'stock market'],
    'Sports News': ['sports news'],
    'Programming/Coding': ['programming', 'coding', 'python', 'javascript', 'java'],
    'Mathematics': ['mathematics', 'math tutorial', 'calculus', 'algebra'],
    'Fashion': ['fashion', 'clothing', 'outfit'],
    'Beauty/Makeup': ['makeup', 'beauty', 'makeup tutorial'],
    'Fitness/Workout': ['fitness', 'workout', 'exercise', 'gym', 'training'],
    'Cooking/Recipes': ['cooking', 'recipe', 'food', 'cooking show'],
    'Travel': ['travel vlog', 'travel video', 'traveling'],
  };

  return keywordMap[genre] || [genre.toLowerCase()];
}

function hideElement(element) {
  if (!element) return;
  element.style.setProperty('display', 'none', 'important');
  element.setAttribute('data-yt-fix-hidden', 'true');
}