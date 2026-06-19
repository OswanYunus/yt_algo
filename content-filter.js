// Content filtering based on preferences
function shouldShowContent(videoElement, videoTitle, channelName, videoTags = []) {
  // This function checks if content should be shown based on user preferences
  getPreferences((prefs) => {
    // Check blacklisted channels
    if (prefs.blacklistedChannels.length > 0) {
      for (const blacklistedChannel of prefs.blacklistedChannels) {
        if (channelName.toLowerCase().includes(blacklistedChannel.toLowerCase()) ||
            videoTitle.toLowerCase().includes(blacklistedChannel.toLowerCase())) {
          hideOrModifyContent(videoElement);
          return;
        }
      }
    }

    // If no genre preferences set, show everything
    if (Object.keys(prefs.selectedGenres).length === 0) {
      return; // Show content
    }

    // Check if content matches selected genres
    const contentMatches = checkContentGenreMatch(videoTitle, channelName, videoTags, prefs.selectedGenres);
    
    if (!contentMatches) {
      hideOrModifyContent(videoElement);
    }
  });
}

function checkContentGenreMatch(videoTitle, channelName, videoTags = [], selectedGenres) {
  // Try to determine content type from title, tags, and channel info
  const titleLower = videoTitle.toLowerCase();
  const channelLower = channelName.toLowerCase();
  const allText = (videoTitle + ' ' + channelName + ' ' + videoTags.join(' ')).toLowerCase();

  // Check against selected genres
  for (const genreKey of Object.keys(selectedGenres)) {
    const { category, subcategory, genre } = parseGenreKey(genreKey);
    const genrePattern = genre.toLowerCase();

    // Simple pattern matching - can be enhanced
    if (allText.includes(genrePattern)) {
      return true;
    }

    // Check for common keywords
    if (matchesGenreKeywords(allText, category, subcategory, genre)) {
      return true;
    }
  }

  return false;
}

function matchesGenreKeywords(text, category, subcategory, genre) {
  const keywords = getGenreKeywords(category, subcategory, genre);
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function getGenreKeywords(category, subcategory, genre) {
  // Map genres to their keywords for better matching
  const keywordMap = {
    'Music': ['music', 'song', 'album', 'remix', 'mix', 'beat', 'lyrics', 'cover', 'live performance'],
    'Afro': ['afro', 'african', 'amapiano', 'afrobeats', 'wizkid', 'davido', 'burna boy'],
    'Pop': ['pop', 'billboard', 'top 40', 'radio hit', 'mainstream'],
    'Hip-Hop/Rap': ['hip hop', 'hiphop', 'rap', 'rapper', 'hip-hop', 'trap', 'freestyle'],
    'R&B': ['r&b', 'rnb', 'rhythm and blues', 'soul'],
    'Rock': ['rock', 'metal', 'guitar', 'band', 'led zeppelin', 'pink floyd'],
    'Electronic/EDM': ['electronic', 'edm', 'dubstep', 'house', 'techno', 'dj'],
    'Jazz': ['jazz', 'blues', 'saxophone', 'trumpet'],
    'Classical': ['classical', 'orchestra', 'symphony', 'piano', 'violin'],
    'Reggae': ['reggae', 'dancehall', 'bob marley'],
    'Latin': ['latin', 'salsa', 'reggaeton', 'latino', 'spanish music'],
    'Bollywood': ['bollywood', 'hindi', 'indian music', 'bollywood movie'],
    'K-Pop': ['kpop', 'k-pop', 'korean', 'bts', 'blackpink', 'exo'],
    
    'Movies': ['movie', 'film', 'cinema', 'watch online'],
    'Horror': ['horror', 'scary', 'thriller', 'supernatural', 'ghost'],
    'Action': ['action', 'fight', 'explosion', 'adventure'],
    'Comedy': ['comedy', 'funny', 'humor', 'laugh'],
    'Drama': ['drama', 'emotional', 'romantic'],
    'Adventure': ['adventure', 'explore', 'journey'],
    'Sci-Fi': ['sci-fi', 'sci fi', 'scifi', 'science fiction', 'futuristic', 'alien'],
    'Fantasy': ['fantasy', 'magic', 'wizard', 'dragon'],
    
    'Podcasts': ['podcast', 'episode', 'audio series'],
    'Sports': ['sports', 'game', 'match', 'highlights', 'goal', 'football', 'basketball'],
    'Gaming': ['gaming', 'game', 'gameplay', 'esports', 'twitch', 'gaming channel'],
    'News': ['news', 'breaking news', 'report', 'cnn', 'bbc'],
    'Education': ['tutorial', 'course', 'learn', 'how to', 'education', 'school'],
    'Lifestyle': ['lifestyle', 'vlog', 'daily', 'fashion', 'beauty'],
    'Documentary': ['documentary', 'doc', 'educational'],
  };

  const genreKeywords = [];
  
  // Add direct keywords
  if (keywordMap[genre]) {
    genreKeywords.push(...keywordMap[genre]);
  }
  
  // Add category keywords if not subcategory
  if (!subcategory && keywordMap[category]) {
    genreKeywords.push(...keywordMap[category]);
  }

  return genreKeywords;
}

function hideOrModifyContent(element) {
  if (!element) return;

  // Hide or modify the element based on its type
  if (element.style) {
    element.style.display = 'none';
    element.style.visibility = 'hidden';
    element.setAttribute('data-yt-fix-hidden', 'true');
  } else {
    // For parent containers
    element.hidden = true;
    element.setAttribute('data-yt-fix-hidden', 'true');
  }
}

function initializeContentFiltering() {
  // Watch for new recommendations being added to the page
  const observer = new MutationObserver(() => {
    // Filter videos periodically
    filterCurrentPageVideos();
  });

  const config = {
    childList: true,
    subtree: true,
    attributes: true
  };

  // Start observing for changes
  const targetNode = document.body;
  if (targetNode) {
    observer.observe(targetNode, config);
  }

  // Initial filter
  filterCurrentPageVideos();

  // Also filter periodically
  setInterval(filterCurrentPageVideos, 5000);
}

function filterCurrentPageVideos() {
  getPreferences((prefs) => {
    // If user hasn't set up preferences yet, don't filter
    if (!prefs.hasSetupPreferences || Object.keys(prefs.selectedGenres).length === 0) {
      return;
    }

    // Find all video recommendations on the page
    const videoElements = document.querySelectorAll('[data-item-id], [data-video-id], ytd-video-renderer, ytd-grid-video-renderer');
    
    videoElements.forEach(element => {
      try {
        const videoTitle = element.getAttribute('title') || element.textContent || '';
        const channelName = element.getAttribute('data-channel') || '';
        
        // Get more info from the element
        const titleElement = element.querySelector('a#video-title, h3 a');
        const actualTitle = titleElement?.textContent || videoTitle;
        
        const channelElement = element.querySelector('ytd-channel-name, a.yt-user-name');
        const actualChannel = channelElement?.textContent || channelName;

        // Check if this content should be shown
        const shouldShow = shouldContentBeShown(actualTitle, actualChannel, prefs);
        
        if (!shouldShow && !element.hasAttribute('data-yt-fix-hidden')) {
          element.style.display = 'none';
          element.setAttribute('data-yt-fix-hidden', 'true');
        } else if (shouldShow && element.hasAttribute('data-yt-fix-hidden')) {
          element.style.display = '';
          element.removeAttribute('data-yt-fix-hidden');
        }
      } catch (e) {
        // Silently ignore errors
      }
    });
  });
}

function shouldContentBeShown(videoTitle, channelName, prefs) {
  // Check blacklist first
  if (prefs.blacklistedChannels && prefs.blacklistedChannels.length > 0) {
    for (const blacklisted of prefs.blacklistedChannels) {
      if (videoTitle.toLowerCase().includes(blacklisted.toLowerCase()) ||
          channelName.toLowerCase().includes(blacklisted.toLowerCase())) {
        return false;
      }
    }
  }

  // If no genre preferences, show everything
  if (!prefs.selectedGenres || Object.keys(prefs.selectedGenres).length === 0) {
    return true;
  }

  // Check genre match
  const allText = (videoTitle + ' ' + channelName).toLowerCase();
  
  for (const genreKey of Object.keys(prefs.selectedGenres)) {
    const { category, genre } = parseGenreKey(genreKey);
    const keywords = getGenreKeywords(category, null, genre);
    
    for (const keyword of keywords) {
      if (allText.includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}
