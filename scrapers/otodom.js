const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeOtodom(url) {
  try {
    console.log('SCRAPER_API_KEY:', process.env.SCRAPER_API_KEY); // Debug log
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
    console.log('Making request to:', apiUrl); // Debug log

    const response = await axios.get(apiUrl);
    const $ = cheerio.load(response.data);
    
    // Debug logs
    console.log('Response status:', response.status);
    console.log('Response data length:', response.data.length);

    // Extract data
    const title = $('h1').text().trim();
    const priceElement = $('strong').filter((i, el) => $(el).text().includes('zł')).first();
    const areaElement = $('div').filter((i, el) => $(el).text().includes('m²')).first();
    const roomsElement = $('div').filter((i, el) => $(el).text().includes('pokoj')).first();

    return {
      title: title || '',
      price: extractNumber(priceElement.text()) || 0,
      area: extractNumber(areaElement.text()) || 0,
      rooms: extractNumber(roomsElement.text()) || 0,
      location: $('address').text().trim() || '',
      description: $('[data-cy="adPageDescription"]').text().trim() || '',
      source: 'otodom.pl'
    };
  } catch (error) {
    console.error('Scraping error:', error.response?.data || error.message);
    throw error;
  }
}

function extractNumber(text) {
  if (!text) return 0;
  const match = text.match(/\d+([.,]\d+)?/);
  return match ? parseFloat(match[0].replace(',', '.')) : 0;
}

module.exports = { scrapeOtodom };
