const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl);
    const $ = cheerio.load(response.data);
    
    // More specific selectors
    const title = $('h1').text().trim();
    const priceText = $('[data-cy="adPageHeaderPrice"]').text().trim();
    const areaText = $('[aria-label="Powierzchnia"]').text().trim();
    const roomsText = $('[aria-label="Liczba pokoi"]').text().trim();
    const locationText = $('[aria-label="Adres"]').text().trim();
    const descriptionText = $('[data-cy="adPageDescription"]').text().trim();

    const price = extractNumber(priceText);
    const area = extractNumber(areaText);
    const rooms = extractNumber(roomsText);

    return {
      title,
      price,
      area,
      rooms,
      location: locationText,
      description: descriptionText,
      source: 'otodom.pl'
    };
  } catch (error) {
    console.error('Scraping error:', error.response?.data || error.message);
    throw error;
  }
}

function extractNumber(text) {
  if (!text) return null;
  const match = text.match(/\d+([.,]\d+)?/);
  return match ? parseFloat(match[0].replace(',', '.')) : null;
}

module.exports = { scrapeOtodom };
