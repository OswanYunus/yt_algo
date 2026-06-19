// Comprehensive content filtering system
let filteringActive = false;
let currentPreferences = null;

// Initialize filtering
function initializeContentFiltering() {
  console.log('YT Fix: Initializing content filtering');
  
  getPreferences((prefs) => {
    currentPreferences = prefs;
    
    // Only activate filtering if user has set preferences with selected genres
    if (prefs.hasSetupPreferences && Object.keys(prefs.selectedGenres).length > 0) {
      filteringActive = true;
      console.log(`YT Fix: Filtering active for ${Object.keys(prefs.selectedGenres).length} genres`);
      
      // Initial filter
      setTimeout(applyComprehensiveFilter, 500);
      
      // Continuous filtering for dynamically loaded content
      const observer = new MutationObserver(() => {
        applyComprehensiveFilter();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      
      // Also filter periodically
      setInterval(applyComprehensiveFilter, 2000);
    } else {
      console.log('YT Fix: Filtering inactive (no preferences set)');
    }
  });
}

function applyComprehensiveFilter() {
  if (!filteringActive || !currentPreferences) return;
  
  // Target all recommendation and video elements
  const selectors = [
    'ytd-video-renderer',
    'ytd-grid-video-renderer', 
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-video-list-renderer',
    'ytd-rich-grid-renderer',
    'a[href*="/watch?v="]',
  ];
  
  document.querySelectorAll(selectors.join(',')).forEach(element => {
    evaluateAndFilterElement(element);
  });
}

function evaluateAndFilterElement(element) {
  // Skip if already processed recently
  if (element.hasAttribute('data-yt-fix-filtered')) {
    return;
  }
  element.setAttribute('data-yt-fix-filtered', 'true');
  
  // Extract video information
  const videoInfo = extractVideoInfo(element);
  
  if (!videoInfo.title || videoInfo.title.length < 2) {
    // Can't determine content, skip
    return;
  }
  
  // Check blacklist first
  if (currentPreferences?.blacklistedChannels && currentPreferences.blacklistedChannels.length > 0) {
    for (const blacklisted of currentPreferences.blacklistedChannels) {
      if (videoInfo.title.toLowerCase().includes(blacklisted.toLowerCase()) ||
          videoInfo.channel.toLowerCase().includes(blacklisted.toLowerCase())) {
        hideElement(element);
        return;
      }
    }
  }
  
  const shouldShow = matchesSelectedGenres(videoInfo);
  
  if (!shouldShow) {
    hideElement(element);
  }
}

function extractVideoInfo(element) {
  const info = {
    title: '',
    channel: '',
    description: ''
  };
  
  try {
    // Get title - check multiple selectors
    let titleElem = element.querySelector('#video-title, h3 a, a#video-title-link, yt-formatted-string.style-scope.ytd-video-renderer');
    if (titleElem) {
      info.title = titleElem.getAttribute('title') || titleElem.textContent || '';
    }
    
    // If still no title, try getting from aria-label
    if (!info.title) {
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        info.title = ariaLabel;
      }
    }
    
    // Get channel
    let channelElem = element.querySelector('ytd-channel-name a, a.yt-user-name');
    if (channelElem) {
      info.channel = channelElem.textContent.trim().replace(/\n/g, ' ');
    }
    
    // Get description or additional metadata
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
  
  // Check each selected genre - must match at least one
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
  
  // Check if ANY keyword matches strongly
  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();
    if (textLower.includes(keywordLower)) {
      return true;
    }
  }
  
  return false;
}

function getStrictGenreKeywords(category, genre) {
  const keywordMap = {
    // MUSIC
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
    
    // MOVIES - TRAILERS  
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
    'Bollywood': ['bollywood movie', 'bollywood trailer', 'hindi movie'],
    'Korean': ['korean movie', 'k-drama'],
    'Japanese': ['japanese movie', 'anime movie'],
    
    // SHORT FILMS
    'Comedy Shorts': ['short film', 'short comedy', 'short'],
    'Horror Shorts': ['short horror', 'horror short'],
    'Drama Shorts': ['short drama'],
    
    // FULL MOVIES (same as trailers essentially)
    
    // PODCASTS
    'Fun and jokes': ['funny podcast', 'comedy podcast'],
    'Sports (Podcasts)': ['sports podcast', 'sports talk show'],
    'Politics': ['political podcast', 'politics podcast', 'news podcast'],
    'Technology': ['tech podcast', 'technology podcast'],
    'Business/Entrepreneurship': ['business podcast', 'entrepreneur', 'startup'],
    'True Crime': ['true crime podcast', 'crime podcast'],
    'Self-Help/Wellness': ['wellness podcast', 'meditation'],
    'Science': ['science podcast'],
    'History': ['history podcast'],
    
    // DOCUMENTARIES
    'Animals/Nature': ['nature documentary', 'animal documentary', 'wildlife'],
    'Crime/True Crime': ['crime documentary', 'true crime'],
    'History': ['history documentary', 'historical documentary'],
    'Science/Technology': ['science documentary', 'tech documentary'],
    'Environmental': ['environmental documentary', 'climate documentary'],
    'Politics': ['political documentary', 'politics documentary'],
    'Space/Universe': ['space documentary', 'cosmos', 'universe documentary'],
    'Biography': ['biography documentary', 'biographical'],
    'War': ['war documentary', 'military documentary'],
    
    // SPORTS (Videos/Highlights)
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
    
    // GAMING
    'Let\'s Plays': ['let\'s play', 'gameplay', 'playthrough'],
    'Game Reviews': ['game review', 'video game review'],
    'Speedruns': ['speedrun', 'world record'],
    'Esports/Tournaments': ['esports', 'gaming tournament', 'competitive'],
    'Game Trailers': ['game trailer'],
    'Streaming Highlights': ['gaming stream', 'twitch', 'highlight'],
    
    // NEWS
    'Breaking News': ['breaking news', 'news report'],
    'Politics': ['politics', 'political'],
    'International': ['international news'],
    'Technology News': ['tech news', 'technology news'],
    'Business News': ['business news', 'stock market'],
    'Sports News': ['sports news'],
    
    // EDUCATION
    'Programming/Coding': ['programming', 'coding', 'python', 'javascript', 'java'],
    'Mathematics': ['mathematics', 'math tutorial', 'calculus', 'algebra'],
    'Science': ['science lesson', 'physics', 'chemistry'],
    'History': ['history lesson', 'historical'],
    
    // LIFESTYLE
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
  
  element.style.display = 'none !important';
  element.style.visibility = 'hidden';
  element.style.height = '0 !important';
  element.style.margin = '0 !important';
  element.style.padding = '0 !important';
  element.style.overflow = 'hidden';
  element.setAttribute('data-yt-fix-hidden', 'true');
  
  // Also hide parent containers
  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    if (parent.classList.contains('yt-dismissible')) {
      parent.style.display = 'none !important';
      parent.setAttribute('data-yt-fix-hidden', 'true');
      break;
    }
    parent = parent.parentElement;
    depth++;
  }
}
