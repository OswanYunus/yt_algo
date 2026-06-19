// First-time setup modal
function createFirstTimeSetupModal() {
  const modal = document.createElement('div');
  modal.id = 'yt-fix-setup-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: #1a1a1a;
    border-radius: 12px;
    border: 1px solid #272727;
    color: #f1f1f1;
    max-width: 600px;
    width: 90%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 24px;
    border-bottom: 1px solid #272727;
    text-align: center;
  `;
  header.innerHTML = `
    <h2 style="font-size: 20px; margin: 0; color: #f1f1f1;">Welcome to YT Fix</h2>
    <p style="font-size: 14px; color: #717171; margin: 8px 0 0 0;">Choose what you want to see on your YouTube feed</p>
  `;

  const body = document.createElement('div');
  body.style.cssText = `
    padding: 24px;
    overflow-y: auto;
    flex: 1;
  `;

  // Create category sections
  let categoriesHTML = '';
  for (const [categoryKey, category] of Object.entries(GENRE_PREFERENCES)) {
    categoriesHTML += createCategorySection(categoryKey, category);
  }
  body.innerHTML = categoriesHTML;

  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 20px 24px;
    border-top: 1px solid #272727;
    display: flex;
    gap: 12px;
    background: #0f0f0f;
  `;

  const submitBtn = document.createElement('button');
  submitBtn.id = 'yt-fix-setup-submit';
  submitBtn.textContent = 'Save Preferences & Refresh';
  submitBtn.style.cssText = `
    flex: 1;
    padding: 12px 24px;
    background: #ff0000;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  `;
  submitBtn.onmouseover = () => submitBtn.style.background = '#cc0000';
  submitBtn.onmouseout = () => submitBtn.style.background = '#ff0000';

  const skipBtn = document.createElement('button');
  skipBtn.id = 'yt-fix-setup-skip';
  skipBtn.textContent = 'Skip for Now';
  skipBtn.style.cssText = `
    padding: 12px 24px;
    background: #272727;
    color: #f1f1f1;
    border: 1px solid #3d3d3d;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  `;
  skipBtn.onmouseover = () => skipBtn.style.background = '#3d3d3d';
  skipBtn.onmouseout = () => skipBtn.style.background = '#272727';

  footer.appendChild(submitBtn);
  footer.appendChild(skipBtn);

  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  modal.appendChild(content);

  return modal;
}

function createCategorySection(categoryKey, category) {
  let html = `
    <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #272727;">
      <h3 style="font-size: 16px; font-weight: 600; margin: 0 0 12px 0; color: #f1f1f1;">
        ${category.icon} ${category.name}
      </h3>
  `;

  if (category.subcategories) {
    // Movies category with subcategories
    for (const [subKey, subcategory] of Object.entries(category.subcategories)) {
      html += `
        <div style="margin-bottom: 14px;">
          <h4 style="font-size: 13px; font-weight: 500; color: #a0a0a0; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.05em;">
            ${subcategory.name}
          </h4>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
      `;
      subcategory.genres.forEach(genre => {
        const genreKey = formatGenreKey(categoryKey, subKey, genre);
        html += `
          <label style="display: flex; align-items: center; cursor: pointer; padding: 8px; border-radius: 4px; background: #272727; transition: all 0.2s;" onmouseover="this.style.background='#3d3d3d'" onmouseout="this.style.background='#272727'">
            <input type="checkbox" class="yt-fix-genre-checkbox" data-genre-key="${genreKey}" style="margin-right: 8px; cursor: pointer;" />
            <span style="font-size: 13px; color: #f1f1f1;">${genre}</span>
          </label>
        `;
      });
      html += `</div></div>`;
    }
  } else {
    // Regular categories
    html += `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">`;
    category.genres.forEach(genre => {
      const genreKey = formatGenreKey(categoryKey, null, genre);
      html += `
        <label style="display: flex; align-items: center; cursor: pointer; padding: 8px; border-radius: 4px; background: #272727; transition: all 0.2s;" onmouseover="this.style.background='#3d3d3d'" onmouseout="this.style.background='#272727'">
          <input type="checkbox" class="yt-fix-genre-checkbox" data-genre-key="${genreKey}" style="margin-right: 8px; cursor: pointer;" />
          <span style="font-size: 13px; color: #f1f1f1;">${genre}</span>
        </label>
      `;
    });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// Show the modal
function showFirstTimeSetupModal() {
  if (document.getElementById('yt-fix-setup-modal')) {
    return; // Already shown
  }

  const modal = createFirstTimeSetupModal();
  document.body.appendChild(modal);

  // Handle submit
  document.getElementById('yt-fix-setup-submit').addEventListener('click', () => {
    const selectedGenres = {};
    document.querySelectorAll('.yt-fix-genre-checkbox:checked').forEach(checkbox => {
      selectedGenres[checkbox.dataset.genreKey] = true;
    });

    if (Object.keys(selectedGenres).length === 0) {
      alert('Please select at least one genre');
      return;
    }

    saveGenrePreferences(selectedGenres, () => {
      modal.remove();
      // Hard refresh the page
      window.location.reload(true);
    });
  });

  // Handle skip
  document.getElementById('yt-fix-setup-skip').addEventListener('click', () => {
    modal.remove();
    // Mark as setup but without preferences
    saveGenrePreferences({}, () => {
      // Just mark that we've shown the modal
    });
  });
}

// Check and show modal on first load
function checkAndShowFirstTimeSetup() {
  hasUserSetupPreferences((hasSetup) => {
    if (!hasSetup) {
      // Wait for DOM to be fully ready
      if (document.body) {
        showFirstTimeSetupModal();
      } else {
        document.addEventListener('DOMContentLoaded', showFirstTimeSetupModal);
      }
    }
  });
}
