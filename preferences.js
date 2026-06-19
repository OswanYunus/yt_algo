// Comprehensive genre and category structure
const GENRE_PREFERENCES = {
  music: {
    name: 'Music',
    icon: '🎵',
    genres: [
      'Afro',
      'Pop',
      'Hip-Hop/Rap',
      'R&B',
      'Rock',
      'Metal',
      'Country',
      'Electronic/EDM',
      'Jazz',
      'Classical',
      'Reggae',
      'Latin',
      'Bollywood',
      'K-Pop',
      'Folk',
      'Blues',
      'Soul',
      'Indie',
      'Alternative',
      'Gospel',
      'Punk',
      'Disco',
      'Funk',
      'Techno',
      'House',
      'Ambient',
      'Experimental'
    ]
  },
  movies: {
    name: 'Movies',
    icon: '🎬',
    subcategories: {
      trailers: {
        name: 'Movie Trailers',
        genres: [
          'Horror',
          'Action',
          'Comedy',
          'Drama',
          'Adventure',
          'Sci-Fi',
          'Fantasy',
          'Thriller',
          'Mystery',
          'Romance',
          'Animation',
          'Documentary',
          'Crime',
          'Western',
          'War',
          'Historical',
          'Superhero',
          'Animated',
          'Bollywood',
          'Korean',
          'Japanese'
        ]
      },
      shortFilms: {
        name: 'Short Films',
        genres: [
          'Comedy Shorts',
          'Horror Shorts',
          'Drama Shorts',
          'Animation Shorts',
          'Experimental Shorts',
          'Student Films',
          'Award-Winning Shorts'
        ]
      },
      fullMovies: {
        name: 'Full Movies',
        genres: [
          'Horror',
          'Action',
          'Comedy',
          'Drama',
          'Adventure',
          'Sci-Fi',
          'Fantasy',
          'Thriller',
          'Mystery',
          'Romance',
          'Animation',
          'Documentary',
          'Crime',
          'Western',
          'War',
          'Historical',
          'Bollywood',
          'Korean',
          'Japanese',
          'French',
          'Spanish'
        ]
      }
    }
  },
  podcasts: {
    name: 'Podcasts',
    icon: '🎙️',
    genres: [
      'Comedy/Fun',
      'Sports (Podcasts)',
      'Politics/News',
      'Technology',
      'Business/Entrepreneurship',
      'Education',
      'True Crime',
      'Self-Help/Wellness',
      'Science',
      'History',
      'Society/Culture',
      'Gaming',
      'Music Industry',
      'Celebrity Interviews',
      'Conspiracy Theories',
      'Philosophy',
      'Health/Fitness',
      'Relationships'
    ]
  },
  documentaries: {
    name: 'Documentaries',
    icon: '🎥',
    genres: [
      'Animals/Nature',
      'Crime/True Crime',
      'History',
      'Science/Technology',
      'Social Issues',
      'Environmental',
      'Politics',
      'Space/Universe',
      'Art/Culture',
      'Religion/Spirituality',
      'Travel',
      'Food/Culinary',
      'Sports Documentaries',
      'Biography',
      'War',
      'Human Rights'
    ]
  },
  sports: {
    name: 'Sports',
    icon: '⚽',
    genres: [
      'Football/Soccer',
      'Basketball',
      'American Football',
      'Baseball',
      'Tennis',
      'Cricket',
      'Hockey',
      'Volleyball',
      'Golf',
      'Boxing/MMA',
      'WWE/Wrestling',
      'Motorsports',
      'Cycling',
      'Swimming',
      'Gymnastics',
      'Rugby',
      'Skateboarding',
      'BMX',
      'Extreme Sports',
      'Badminton',
      'Table Tennis',
      'Archery'
    ]
  },
  gaming: {
    name: 'Gaming',
    icon: '🎮',
    genres: [
      'Let\'s Plays',
      'Game Reviews',
      'Speedruns',
      'Esports/Tournaments',
      'Game Trailers',
      'Indie Games',
      'Mobile Gaming',
      'Retro Gaming',
      'Gaming Guides/Tutorials',
      'Gaming Comedy',
      'Streaming Highlights',
      'Game Development'
    ]
  },
  news: {
    name: 'News & Current Events',
    icon: '📰',
    genres: [
      'Breaking News',
      'Politics',
      'International',
      'Technology News',
      'Business News',
      'Weather',
      'Entertainment News',
      'Science News',
      'Health News',
      'Sports News',
      'Local News',
      'Fact-Checking'
    ]
  },
  entertainment: {
    name: 'Entertainment',
    icon: '⭐',
    genres: [
      'Celebrity News',
      'Movie Reviews',
      'TV Show Reviews',
      'Red Carpet Events',
      'Celebrity Interviews',
      'Gossip',
      'Meme/Comedy',
      'Viral Videos',
      'Social Media',
      'Award Shows'
    ]
  },
  education: {
    name: 'Education',
    icon: '📚',
    genres: [
      'Programming/Coding',
      'Mathematics',
      'Physics',
      'Chemistry',
      'Biology',
      'Languages',
      'History',
      'Geography',
      'Literature',
      'Art/Design',
      'Music Theory',
      'Engineering',
      'Psychology',
      'Economics',
      'Business',
      'Finance',
      'Entrepreneurship'
    ]
  },
  lifestyle: {
    name: 'Lifestyle',
    icon: '🌟',
    genres: [
      'Fashion',
      'Beauty/Makeup',
      'Fitness/Workout',
      'Yoga',
      'Cooking/Recipes',
      'Gardening',
      'Interior Design',
      'Travel Vlogs',
      'Parenting',
      'Pets',
      'DIY/Crafts',
      'Home Improvement',
      'Mental Health',
      'Dating Advice',
      'Personal Finance'
    ]
  },
  creative: {
    name: 'Creative',
    icon: '🎨',
    genres: [
      'Digital Art',
      'Photography',
      'Graphic Design',
      'Video Editing',
      'Animation',
      'Music Production',
      'Songwriting',
      'Writing/Storytelling',
      'Drawing Tutorials',
      'Modeling',
      'Dance',
      'Performing Arts'
    ]
  }
};

// Default preferences structure
const DEFAULT_PREFERENCES = {
  selectedGenres: {},
  blacklistedChannels: [],
  hasSetupPreferences: false,
  setupDate: null
};

// Initialize preferences
function initializePreferences(callback) {
  chrome.storage.local.get(['preferences'], (data) => {
    if (!data.preferences) {
      const newPrefs = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
      chrome.storage.local.set({ preferences: newPrefs }, callback);
    } else {
      callback(data.preferences);
    }
  });
}

// Get all preferences
function getPreferences(callback) {
  chrome.storage.local.get(['preferences'], (data) => {
    callback(data.preferences || DEFAULT_PREFERENCES);
  });
}

// Save genre selections
function saveGenrePreferences(selectedGenres, callback) {
  getPreferences((prefs) => {
    prefs.selectedGenres = selectedGenres;
    prefs.hasSetupPreferences = true;
    prefs.setupDate = new Date().toISOString();
    chrome.storage.local.set({ preferences: prefs }, callback);
  });
}

// Save blacklisted channels
function saveBlacklistedChannels(channels, callback) {
  getPreferences((prefs) => {
    prefs.blacklistedChannels = channels;
    chrome.storage.local.set({ preferences: prefs }, callback);
  });
}

// Add a channel to blacklist
function addBlacklistedChannel(channelId, callback) {
  getPreferences((prefs) => {
    if (!prefs.blacklistedChannels.includes(channelId)) {
      prefs.blacklistedChannels.push(channelId);
      chrome.storage.local.set({ preferences: prefs }, callback);
    } else {
      callback();
    }
  });
}

// Remove a channel from blacklist
function removeBlacklistedChannel(channelId, callback) {
  getPreferences((prefs) => {
    prefs.blacklistedChannels = prefs.blacklistedChannels.filter(id => id !== channelId);
    chrome.storage.local.set({ preferences: prefs }, callback);
  });
}

// Check if preferences are set up
function hasUserSetupPreferences(callback) {
  getPreferences((prefs) => {
    callback(prefs.hasSetupPreferences === true);
  });
}

// Get selected genres for filtering
function getSelectedGenres(callback) {
  getPreferences((prefs) => {
    callback(prefs.selectedGenres || {});
  });
}

// Format genre key
function formatGenreKey(category, subcategory, genre) {
  if (subcategory) {
    return `${category}:${subcategory}:${genre}`;
  }
  return `${category}:${genre}`;
}

// Parse genre key
function parseGenreKey(key) {
  const parts = key.split(':');
  if (parts.length === 3) {
    return {
      category: parts[0],
      subcategory: parts[1],
      genre: parts[2]
    };
  }
  return {
    category: parts[0],
    subcategory: null,
    genre: parts[1]
  };
}
